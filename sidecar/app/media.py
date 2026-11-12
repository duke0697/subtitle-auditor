from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

import numpy as np

from .config import ffmpeg_binary

EXTRACTABLE = {"subrip", "ass", "ssa", "webvtt", "mov_text"}
BITMAP = {"hdmv_pgs_subtitle", "dvd_subtitle", "dvb_subtitle", "xsub"}


def _run(command: list[str]) -> str:
    completed = subprocess.run(
        command,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or f"command failed: {command[0]}")
    return completed.stdout


def probe(path: str) -> dict[str, Any]:
    raw = _run(
        [
            str(ffmpeg_binary("ffprobe.exe")),
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            path,
        ]
    )
    data = json.loads(raw)
    streams = data.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    subtitles = [s for s in streams if s.get("codec_type") == "subtitle"]
    subtitle_streams = []
    for relative_index, stream in enumerate(subtitles):
        codec = stream.get("codec_name", "unknown")
        tags = stream.get("tags", {})
        subtitle_streams.append(
            {
                "index": stream.get("index", 0),
                "relativeIndex": relative_index,
                "codec": codec,
                "language": tags.get("language", ""),
                "title": tags.get("title", ""),
                "extractable": codec in EXTRACTABLE and codec not in BITMAP,
            }
        )
    duration = float(data.get("format", {}).get("duration", 0) or 0)
    fps_raw = (video or {}).get("avg_frame_rate", "0/1")
    try:
        num, den = (int(part) for part in fps_raw.split("/"))
        fps = round(num / den, 2) if den else 0.0
    except (ValueError, ZeroDivisionError):
        fps = 0.0
    return {
        "path": path,
        "durationMs": int(duration * 1000),
        "sizeBytes": int(Path(path).stat().st_size),
        "container": data.get("format", {}).get("format_name", ""),
        "videoCodec": (video or {}).get("codec_name", ""),
        "audioCodec": (audio or {}).get("codec_name", ""),
        "width": (video or {}).get("width", 0),
        "height": (video or {}).get("height", 0),
        "fps": fps,
        "subtitleStreams": subtitle_streams,
    }


def waveform(path: str, buckets: int = 1600) -> dict[str, Any]:
    import av

    buckets = max(64, min(4000, buckets))
    container = av.open(path)
    try:
        stream = next((s for s in container.streams if s.type == "audio"), None)
        if stream is None:
            return {"peaks": [], "durationMs": 0}
        duration_ms = int(float(container.duration or 0) / 1000)
        if duration_ms <= 0 and stream.duration and stream.time_base:
            duration_ms = int(float(stream.duration * stream.time_base) * 1000)
        resampler = av.AudioResampler(format="flt", layout="mono", rate=16000)
        total_samples = max(1, int(16000 * duration_ms / 1000))
        per_bucket = max(1, total_samples // buckets)
        peaks = np.zeros(buckets, dtype=np.float32)
        position = 0
        for frame in container.decode(stream):
            for resampled in resampler.resample(frame):
                samples = resampled.to_ndarray().astype(np.float32).reshape(-1)
                for value in samples:
                    bucket = min(buckets - 1, position // per_bucket)
                    magnitude = abs(float(value))
                    if magnitude > peaks[bucket]:
                        peaks[bucket] = magnitude
                    position += 1
        for resampled in resampler.resample(None):
            samples = resampled.to_ndarray().astype(np.float32).reshape(-1)
            for value in samples:
                bucket = min(buckets - 1, position // per_bucket)
                magnitude = abs(float(value))
                if magnitude > peaks[bucket]:
                    peaks[bucket] = magnitude
                position += 1
        maximum = float(peaks.max()) if peaks.size else 0.0
        if maximum > 0:
            peaks = peaks / maximum
        return {
            "peaks": [round(float(value), 3) for value in peaks],
            "durationMs": duration_ms,
        }
    finally:
        container.close()


def extract_subtitle(video_path: str, relative_index: int, out_path: str) -> str:
    output = Path(out_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    _run(
        [
            str(ffmpeg_binary("ffmpeg.exe")),
            "-v",
            "error",
            "-y",
            "-i",
            video_path,
            "-map",
            f"0:s:{relative_index}",
            "-c:s",
            "srt",
            str(output),
        ]
    )
    return str(output)
