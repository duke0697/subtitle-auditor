from __future__ import annotations

import os
import threading
from typing import Callable, Optional

from . import compat  # noqa: F401 - patch av.open before faster-whisper imports
from .align import simplify
from .config import model_path
from .glossary import PatternIndex, build_index, normalize_segment
from .models import CancelledError, cuda_status, is_downloaded
from .schema import AsrSegment, AsrWord


def _simplify(text: str) -> str:
    """Whisper often emits Traditional Chinese; keep the mapping 1:1."""
    converted = simplify(text)
    return converted if len(converted) == len(text) else text


def build_prompt(glossary: Optional[list[str]], reference: str = "") -> str:
    """Turn the user glossary into a decoding prompt; terms present in the subtitle get the budget first."""
    candidates: list[str] = []
    for raw in glossary or []:
        term = str(raw).strip()
        if term and term not in candidates:
            candidates.append(term)
    if reference:
        haystack = reference.lower()
        hits = [term for term in candidates if term.lower() in haystack]
        seen = set(hits)
        candidates = hits + [term for term in candidates if term not in seen]
    terms: list[str] = []
    length = 0
    for term in candidates:
        if length + len(term) > 160:
            continue
        terms.append(term)
        length += len(term) + 1
    if not terms:
        return "以下是普通话的句子。"
    return "以下是普通话讲解，涉及" + "、".join(terms) + "等术语。"

COMPUTE_TYPES = {"cuda": "int8_float16", "cpu": "int8"}

_models: dict[tuple[str, str], object] = {}
_model_lock = threading.Lock()
_cuda_failure: Optional[str] = None


def resolve_device(device_mode: str, cuda_ok: bool, cuda_reason: str) -> tuple[str, Optional[str]]:
    """Map the requested mode to a device; the error is only set for a forced GPU."""
    if device_mode == "cpu":
        return "cpu", None
    if cuda_ok:
        return "cuda", None
    if device_mode == "cuda":
        return "cpu", f"GPU 不可用：{cuda_reason}。请在设置页安装 GPU 组件，或将推理设备切换为 CPU。"
    return "cpu", None


def _model(path: str, device: str):
    """Load once per model/device pair; only one model stays resident."""
    key = (path, device)
    with _model_lock:
        cached = _models.get(key)
        if cached is None:
            from faster_whisper import WhisperModel

            cached = WhisperModel(
                path,
                device=device,
                compute_type=COMPUTE_TYPES[device],
                cpu_threads=max(1, (os.cpu_count() or 4) - 1),
            )
            _models.clear()
            _models[key] = cached
        return cached


def _run(
    path: str,
    media_path: str,
    device: str,
    language: Optional[str],
    prompt_text: Optional[str],
    pattern_index: PatternIndex,
    duration_ms: int,
    progress: Callable[[float, str], None],
    on_segment: Callable[[AsrSegment], None],
    cancel,
) -> dict:
    model = _model(path, device)
    progress(0.01, f"ASR 设备：{device} ({COMPUTE_TYPES[device]})")
    # initial_prompt only conditions the first 30s window; hotwords are re-applied to every window.
    segments_iter, info = model.transcribe(
        media_path,
        language=language or None,
        hotwords=prompt_text or None,
        beam_size=5,
        word_timestamps=True,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
        condition_on_previous_text=False,
    )

    segments: list[AsrSegment] = []
    try:
        for index, segment in enumerate(segments_iter):
            if cancel.is_set():
                raise CancelledError()
            words: list[AsrWord] = []
            for word_index, word in enumerate(segment.words or []):
                text = (word.word or "").strip()
                if not text:
                    continue
                words.append(
                    AsrWord(
                        id=f"w-{index}-{word_index}",
                        text=_simplify(text),
                        start_ms=int(word.start * 1000),
                        end_ms=int(word.end * 1000),
                        probability=float(word.probability or 0.0),
                        segment_id=f"seg-{index}",
                    )
                )
            item = AsrSegment(
                id=f"seg-{index}",
                start_ms=int(segment.start * 1000),
                end_ms=int(segment.end * 1000),
                text=_simplify((segment.text or "").strip()),
                avg_logprob=float(segment.avg_logprob or 0.0),
                no_speech_prob=float(segment.no_speech_prob or 0.0),
                words=words,
            )
            normalize_segment(item, pattern_index)
            segments.append(item)
            on_segment(item)
            if duration_ms > 0:
                progress(min(0.99, segment.end * 1000 / duration_ms), f"语音识别 {segment.end:.1f}s")
    finally:
        close = getattr(segments_iter, "close", None)
        if close is not None:
            close()

    progress(1.0, "语音识别完成")
    return {
        "segments": segments,
        "device": device,
        "computeType": COMPUTE_TYPES[device],
        "language": getattr(info, "language", language),
        "languageProbability": float(getattr(info, "language_probability", 0.0) or 0.0),
        "warning": None,
    }


def transcribe(
    media_path: str,
    model_name: str,
    device_mode: str,
    language: Optional[str],
    glossary: Optional[list[str]],
    duration_ms: int,
    progress: Callable[[float, str], None],
    on_segment: Callable[[AsrSegment], None],
    cancel,
    reference: str = "",
) -> dict:
    global _cuda_failure
    if not is_downloaded(model_name):
        raise RuntimeError(f"模型 {model_name} 尚未下载，请先在设置中下载。")
    path = str(model_path(model_name))

    if device_mode == "cpu":
        cuda_ok, cuda_reason = False, ""
    elif _cuda_failure is not None:
        cuda_ok, cuda_reason = False, "GPU 推理失败"
    else:
        status = cuda_status()
        cuda_ok, cuda_reason = bool(status["available"]), str(status["reason"] or "")

    device, error = resolve_device(device_mode, cuda_ok, cuda_reason)
    if error:
        raise RuntimeError(error)

    prompt_text = build_prompt(glossary, reference)
    pattern_index = build_index(glossary)
    warning: Optional[str] = None
    if device == "cuda":
        try:
            progress(0.0, "加载语音模型（GPU）")
            return _run(
                path, media_path, "cuda", language, prompt_text, pattern_index, duration_ms, progress, on_segment, cancel
            )
        except CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - CUDA can fail only at inference time
            _cuda_failure = str(exc)
            with _model_lock:
                _models.pop((path, "cuda"), None)
            if device_mode == "cuda":
                raise RuntimeError(f"GPU 推理失败：{exc}") from exc
            cuda_reason = "GPU 推理失败"
            warning = f"GPU 推理失败，已改用 CPU：{exc}"
    elif cuda_reason:
        warning = f"{cuda_reason}，已使用 CPU 识别"

    progress(0.0, f"使用 CPU 识别（{cuda_reason}）" if cuda_reason else "加载语音模型（CPU）")
    result = _run(
        path, media_path, "cpu", language, prompt_text, pattern_index, duration_ms, progress, on_segment, cancel
    )
    result["warning"] = warning
    return result
