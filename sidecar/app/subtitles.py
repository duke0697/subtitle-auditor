from __future__ import annotations

from pathlib import Path

import pysubs2
from charset_normalizer import from_bytes

from .schema import Cue


def detect_encoding(path: str) -> str:
    raw = Path(path).read_bytes()[: 256 * 1024]
    for bom, encoding in (
        (b"\xef\xbb\xbf", "utf-8-sig"),
        (b"\xff\xfe\x00\x00", "utf-32-le"),
        (b"\x00\x00\xfe\xff", "utf-32-be"),
        (b"\xff\xfe", "utf-16-le"),
        (b"\xfe\xff", "utf-16-be"),
    ):
        if raw.startswith(bom):
            return encoding
    try:
        raw.decode("utf-8")
        return "utf-8"
    except UnicodeDecodeError:
        pass
    try:
        decoded = raw.decode("gb18030")
        cjk = sum(1 for char in decoded if "一" <= char <= "鿿")
        if cjk >= 2:
            return "gb18030"
    except UnicodeDecodeError:
        pass
    best = from_bytes(raw).best()
    if best and best.encoding:
        return best.encoding
    return "utf-8"


def load(path: str) -> tuple[list[Cue], str, str]:
    encoding = detect_encoding(path)
    subs = pysubs2.load(path, encoding=encoding)
    cues: list[Cue] = []
    for index, event in enumerate(subs):
        if event.is_comment or getattr(event, "is_drawing", False):
            continue
        text = " ".join(part.strip() for part in event.plaintext.splitlines()).strip()
        if not text:
            continue
        cues.append(
            Cue(
                id=f"cue-{index}",
                index=index,
                start_ms=int(event.start),
                end_ms=int(event.end),
                text=text,
            )
        )
    suffix = Path(path).suffix.lower().lstrip(".") or "srt"
    return cues, encoding, suffix


def find_overlaps(cues: list[Cue], threshold_ms: int = 100) -> list[tuple[Cue, Cue, int]]:
    overlaps: list[tuple[Cue, Cue, int]] = []
    ordered = sorted(cues, key=lambda cue: (cue.start_ms, cue.end_ms))
    for previous, current in zip(ordered, ordered[1:]):
        overlap = previous.end_ms - current.start_ms
        if overlap > threshold_ms:
            overlaps.append((previous, current, overlap))
    return overlaps
