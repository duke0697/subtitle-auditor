from __future__ import annotations

import io
import contextlib
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

from .models import CancelledError

BAND_TOP = 0.86
BAND_BOTTOM = 0.995
OCR_WIDTH = 640
MIN_SCORE = 0.6
MIN_LINE_RATIO = 0.08
CHANGE_THRESHOLD = 6.0
FORCE_INTERVAL_S = 2.0
SAMPLE_INTERVAL_S = 0.25
CENTER_TOLERANCE = 0.25


@dataclass
class OcrCue:
    start_s: float
    end_s: float
    text: str
    score: float


def _is_cjk(text: str) -> bool:
    return any("一" <= char <= "鿿" for char in text)


def _is_text(text: str) -> bool:
    return _is_cjk(text) or (len(text) >= 4 and any(char.isalnum() for char in text))


_engine = None
_engine_lock = threading.Lock()


def _get_engine():
    global _engine
    with _engine_lock:
        if _engine is None:
            from rapidocr import RapidOCR

            with contextlib.redirect_stdout(io.StringIO()):
                _engine = RapidOCR(
                    params={
                        "Global.use_cls": False,
                        "Global.log_level": "error",
                        "Det.limit_type": "max",
                        "Det.limit_side_len": 960,
                    }
                )
        return _engine


def _crop_band(frame) -> "object":
    import cv2

    height, width = frame.shape[:2]
    band = frame[int(height * BAND_TOP) : int(height * BAND_BOTTOM), :]
    scale = OCR_WIDTH / width
    return cv2.resize(band, (OCR_WIDTH, max(24, int(band.shape[0] * scale))))


def _signature(band) -> "object":
    import cv2
    import numpy as np

    gray = cv2.cvtColor(band, cv2.COLOR_BGR2GRAY)
    return cv2.resize(gray, (64, 8)).astype(np.int16)


def _read_lines(band) -> list[tuple[str, float]]:
    """Return (text, score) for the subtitle line(s) in the band."""
    result = _get_engine()(band)
    if result.boxes is None or len(result.boxes) == 0:
        return []
    width = band.shape[1]
    boxes = []
    for box, text, score in zip(result.boxes, result.txts or [], result.scores or []):
        text = (text or "").strip()
        score = float(score)
        if not text or score < MIN_SCORE:
            continue
        ys = [float(point[1]) for point in box]
        xs = [float(point[0]) for point in box]
        boxes.append(
            {
                "top": min(ys),
                "bottom": max(ys),
                "left": min(xs),
                "right": max(xs),
                "text": text,
                "score": score,
            }
        )
    return _select_lines(boxes, width, band.shape[0])


def _same_line(left: dict, right: dict) -> bool:
    height = max(left["bottom"] - left["top"], right["bottom"] - right["top"], 1.0)
    return abs((left["top"] + left["bottom"]) - (right["top"] + right["bottom"])) <= height


def _join_segments(boxes: list[dict]) -> str:
    """Concatenate same-line boxes; overlapping detector boxes repeat edge characters."""
    text = boxes[0]["text"]
    for previous, current in zip(boxes, boxes[1:]):
        part = current["text"]
        if previous["right"] - current["left"] > 0:
            for size in range(min(len(text), len(part)), 0, -1):
                if text.endswith(part[:size]):
                    text += part[size:]
                    break
            else:
                text += part
        else:
            text += part
    return text


def _select_lines(boxes: list[dict], width: int, height: int) -> list[tuple[str, float]]:
    """Keep only the centered subtitle band; screen labels and clipped UI art are dropped."""
    boxes = [
        item
        for item in boxes
        if item["top"] >= 1
        and item["bottom"] <= height - 1
        and item["bottom"] - item["top"] <= height * 0.8
        and item["right"] - item["left"] >= width * MIN_LINE_RATIO
    ]
    if not boxes:
        return []
    boxes.sort(key=lambda item: item["bottom"])
    anchor = next(
        (
            item
            for item in reversed(boxes)
            if abs((item["left"] + item["right"]) / 2 / width - 0.5) <= CENTER_TOLERANCE
            and _is_text(item["text"])
        ),
        None,
    )
    if anchor is None:
        return []

    line_height = max(1.0, anchor["bottom"] - anchor["top"])
    kept = [
        item
        for item in boxes
        if item["bottom"] >= anchor["top"] - line_height * 1.2
        and max(item["left"] - anchor["right"], anchor["left"] - item["right"], 0) <= line_height
        # Printed module labels are smaller than the burned-in subtitle; a real second
        # subtitle line shares the same font size.
        and 0.7 * line_height <= item["bottom"] - item["top"] <= 1.4 * line_height
        and _is_text(item["text"])
    ]
    if not kept:
        return []

    kept.sort(key=lambda item: (item["top"], item["left"]))
    lines: list[list[dict]] = [[kept[0]]]
    for item in kept[1:]:
        if _same_line(lines[-1][0], item):
            lines[-1].append(item)
        else:
            lines.append([item])
    result: list[tuple[str, float]] = []
    for line in lines:
        line.sort(key=lambda item: item["left"])
        result.append((_join_segments(line), min(item["score"] for item in line)))
    return result


def merge_samples(samples: list[tuple[float, str, float]]) -> list[OcrCue]:
    """Merge per-sample OCR results into cues; a text change only splits once the next sample confirms it."""
    cues: list[OcrCue] = []
    current: Optional[OcrCue] = None
    pending: Optional[OcrCue] = None
    last_time = samples[-1][0] if samples else 0.0
    for timestamp, text, score in samples:
        if current is None:
            if text:
                current = OcrCue(start_s=timestamp, end_s=timestamp, text=text, score=score)
            continue
        if text == current.text:
            current.end_s = timestamp
            current.score = max(current.score, score)
            pending = None
            continue
        if not text:
            if pending is not None:
                current.end_s = pending.start_s
                cues.append(current)
                pending.end_s = timestamp
                cues.append(pending)
                pending = None
            else:
                current.end_s = timestamp
                cues.append(current)
            current = None
            continue
        if pending is not None and text == pending.text:
            current.end_s = pending.start_s
            cues.append(current)
            current = OcrCue(
                start_s=pending.start_s, end_s=timestamp, text=text, score=max(pending.score, score)
            )
            pending = None
            continue
        if pending is None:
            pending = OcrCue(start_s=timestamp, end_s=timestamp, text=text, score=score)
            continue
        # A third distinct text: the previous pending sample was a real change after all.
        current.end_s = pending.start_s
        cues.append(current)
        current = pending
        pending = OcrCue(start_s=timestamp, end_s=timestamp, text=text, score=score)

    if pending is not None and current is not None:
        current.end_s = pending.start_s
        cues.append(current)
        current = pending
    if current is not None:
        current.end_s = max(current.end_s, last_time)
        cues.append(current)

    for cue in cues:
        if cue.end_s < cue.start_s:
            cue.end_s = cue.start_s
    return cues


def _write_srt(cues: list[OcrCue], out_path: Path) -> None:
    import pysubs2

    subs = pysubs2.SSAFile()
    for cue in cues:
        subs.append(
            pysubs2.SSAEvent(
                start=int(round(cue.start_s * 1000)),
                end=int(round(cue.end_s * 1000)),
                text=cue.text,
            )
        )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    subs.save(str(out_path), format_="srt")


def extract_subtitles(
    video_path: str,
    out_path: str,
    progress: Callable[[float, str], None],
    cancel,
) -> dict:
    import av
    import numpy as np

    container = av.open(video_path)
    try:
        stream = container.streams.video[0]
        duration = float(container.duration / av.time_base) if container.duration else 0.0
        samples: list[tuple[float, str, float]] = []
        previous = None
        last_ocr = -FORCE_INTERVAL_S
        next_sample = 0.0

        for frame in container.decode(stream):
            if cancel.is_set():
                raise CancelledError()
            timestamp = float(frame.pts * stream.time_base) if frame.pts is not None else next_sample
            if timestamp < next_sample:
                continue
            next_sample = timestamp + SAMPLE_INTERVAL_S

            band = _crop_band(frame.to_ndarray(format="bgr24"))
            signature = _signature(band)
            changed = previous is None or float(np.abs(signature - previous).mean()) >= CHANGE_THRESHOLD
            previous = signature
            if not changed and timestamp - last_ocr < FORCE_INTERVAL_S:
                continue

            last_ocr = timestamp
            lines = _read_lines(band)
            text = "\n".join(line[0] for line in lines)
            score = min((line[1] for line in lines), default=0.0)
            samples.append((timestamp, text, score))
            if duration > 0:
                progress(min(0.99, timestamp / duration), f"识别画面字幕 {timestamp:.0f}s")
    finally:
        container.close()

    cues = [cue for cue in merge_samples(samples) if cue.text]
    if not cues:
        raise RuntimeError("画面中没有检测到字幕，请确认视频是否有烧录字幕。")

    target = Path(out_path)
    _write_srt(cues, target)
    progress(1.0, f"已提取 {len(cues)} 条字幕")
    return {"path": str(target), "cues": len(cues), "durationMs": int(duration * 1000)}
