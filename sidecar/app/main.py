from __future__ import annotations

import sys
import threading
import traceback
from datetime import datetime
from typing import Any

if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")
if sys.stderr.encoding != "utf-8":
    sys.stderr.reconfigure(encoding="utf-8")
try:
    if sys.stdin is not None and sys.stdin.encoding != "utf-8":
        sys.stdin.reconfigure(encoding="utf-8")
except (AttributeError, OSError):
    pass

from . import align, asr, media, models, rules, subtitles, subtitle_ocr, timing  # noqa: E402
from .config import DEFAULT_OPTIONS, SCHEMA_VERSION, ensure_dirs, setup_dll_paths  # noqa: E402
from .rpc import ASYNC, RpcServer  # noqa: E402
from .schema import AnalysisResult, jsonable  # noqa: E402

VERSION = "0.1.0"
jobs: dict[str, threading.Event] = {}
jobs_lock = threading.Lock()


def _notify(server: RpcServer, method: str, params: Any) -> None:
    server.notify(method, params)


def _progress(server: RpcServer, job_id: str, stage: str, value: float, message: str) -> None:
    _notify(
        server,
        "progress",
        {"jobId": job_id, "stage": stage, "progress": max(0.0, min(1.0, value)), "message": message},
    )


def _run_analysis(server: RpcServer, job_id: str, params: dict, cancel: threading.Event) -> None:
    try:
        options = {**DEFAULT_OPTIONS, **(params.get("options") or {})}
        video_path = params["videoPath"]
        subtitle_path = params["subtitlePath"]
        _progress(server, job_id, "probe", 0.02, "读取媒体信息")
        info = media.probe(video_path)
        duration = int(info.get("durationMs", 0))
        _progress(server, job_id, "subtitle", 0.05, "解析字幕")
        cues, encoding, fmt = subtitles.load(subtitle_path)
        if not cues:
            raise RuntimeError("字幕为空或无法解析。")
        reference = " ".join(cue.text for cue in cues)

        def on_asr_segment(segment) -> None:
            _notify(server, "asr.segment", {"jobId": job_id, "segment": jsonable(segment)})

        def on_asr_progress(value: float, message: str) -> None:
            _progress(server, job_id, "asr", 0.10 + value * 0.75, message)

        asr_result = asr.transcribe(
            video_path,
            str(options.get("model", "medium")),
            str(options.get("device", "auto")),
            options.get("language"),
            options.get("glossary"),
            duration,
            on_asr_progress,
            on_asr_segment,
            cancel,
            reference=reference,
        )
        segments = asr_result["segments"]
        _progress(server, job_id, "align", 0.88, "对齐字幕与语音")
        bundle = align.align(cues, segments, options)
        _progress(server, job_id, "align", 0.94, "生成审查结论")
        findings = rules.build_findings(cues, segments, bundle, options)
        findings.extend(timing.build_timing_findings(cues, segments, bundle, options))
        summary = rules.build_summary(cues, segments, bundle, findings, duration)
        result = AnalysisResult(
            schema_version=SCHEMA_VERSION,
            created_at=datetime.now().astimezone().isoformat(timespec="seconds"),
            media=info,
            subtitle={
                "path": subtitle_path,
                "format": fmt,
                "encoding": encoding,
                "trackIndex": params.get("trackIndex"),
            },
            model={
                "name": str(options.get("model", "medium")),
                "device": asr_result["device"],
                "computeType": asr_result["computeType"],
                "language": asr_result["language"],
            },
            cues=cues,
            segments=segments,
            findings=findings,
            summary=summary,
            options=options,
        )
        _progress(server, job_id, "done", 1.0, "分析完成")
        if asr_result.get("warning"):
            _notify(server, "log", {"level": "warn", "message": asr_result["warning"]})
        _notify(server, "job.done", {"jobId": job_id, "result": jsonable(result)})
    except models.CancelledError:
        _notify(server, "job.error", {"jobId": job_id, "message": "任务已取消", "detail": "cancelled"})
    except Exception as exc:  # noqa: BLE001 - surface to UI
        _notify(
            server,
            "job.error",
            {
                "jobId": job_id,
                "message": str(exc),
                "detail": traceback.format_exc(limit=6),
            },
        )
    finally:
        with jobs_lock:
            jobs.pop(job_id, None)


def dispatch(method: str, params: dict, responder, server: RpcServer):
    if method == "system.info":
        return {
            "version": VERSION,
            "python": sys.version.split()[0],
            "schemaVersion": SCHEMA_VERSION,
            "models": models.list_models(),
            "gpu": models.gpu_status(),
        }
    if method == "media.probe":
        return media.probe(params["path"])
    if method == "media.waveform":
        return media.waveform(params["path"], int(params.get("buckets", 1600)))
    if method == "media.extractSubtitle":
        return {
            "path": media.extract_subtitle(
                params["videoPath"], int(params["streamIndex"]), params["outPath"]
            )
        }
    if method == "models.list":
        return models.list_models()
    if method == "models.download":
        name = params["name"]
        mirror = params.get("mirror")

        def worker() -> None:
            try:
                path = models.download_model(
                    name,
                    mirror,
                    lambda value, message: _notify(
                        server,
                        "model.progress",
                        {"name": name, "progress": value, "message": message},
                    ),
                    threading.Event(),
                )
                responder.respond({"path": path})
            except Exception as exc:  # noqa: BLE001
                responder.fail(str(exc))

        threading.Thread(target=worker, daemon=True).start()
        return ASYNC
    if method == "models.installGpu":
        def worker() -> None:
            try:
                result = models.install_gpu(
                    lambda value, message: _notify(
                        server,
                        "model.progress",
                        {"name": "gpu", "progress": value, "message": message},
                    ),
                    threading.Event(),
                )
                responder.respond(result)
            except Exception as exc:  # noqa: BLE001
                responder.fail(str(exc))

        threading.Thread(target=worker, daemon=True).start()
        return ASYNC
    if method == "ocr.extract":
        video_path = params["videoPath"]
        out_path = params["outPath"]
        cancel = threading.Event()
        with jobs_lock:
            jobs["ocr"] = cancel

        def ocr_worker() -> None:
            try:
                result = subtitle_ocr.extract_subtitles(
                    video_path,
                    out_path,
                    lambda value, message: _notify(
                        server, "ocr.progress", {"progress": value, "message": message}
                    ),
                    cancel,
                )
                responder.respond(result)
            except models.CancelledError:
                responder.fail("已取消")
            except Exception as exc:  # noqa: BLE001
                responder.fail(str(exc))
            finally:
                with jobs_lock:
                    jobs.pop("ocr", None)

        threading.Thread(target=ocr_worker, daemon=True).start()
        return ASYNC
    if method == "analyze":
        job_id = params["jobId"]
        cancel = threading.Event()
        with jobs_lock:
            jobs[job_id] = cancel
        responder.respond({"jobId": job_id})
        threading.Thread(
            target=_run_analysis, args=(server, job_id, params, cancel), daemon=True
        ).start()
        return ASYNC
    if method == "cancel":
        with jobs_lock:
            event = jobs.get(params.get("jobId", ""))
        if event is not None:
            event.set()
        return {"cancelled": event is not None}
    raise RuntimeError(f"未知方法：{method}")


def main() -> None:
    ensure_dirs()
    setup_dll_paths()
    server = RpcServer(lambda method, params, responder: dispatch(method, params, responder, server))
    server.serve_forever()


if __name__ == "__main__":
    main()
