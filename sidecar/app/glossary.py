from __future__ import annotations

from .pinyin import primary_reading
from .schema import AsrSegment

Pattern = tuple[str, tuple[str, ...]]
PatternIndex = dict[str, list[Pattern]]


def build_index(glossary: list[str] | None) -> PatternIndex:
    """Group terms by their first syllable so scanning stays proportional to the text length."""
    index: PatternIndex = {}
    seen: set[str] = set()
    for raw in glossary or []:
        term = str(raw).strip()
        if len(term) < 2 or term in seen:
            continue
        seen.add(term)
        readings = tuple(primary_reading(char) for char in term)
        index.setdefault(readings[0], []).append((term, readings))
    for group in index.values():
        group.sort(key=lambda item: len(item[0]), reverse=True)
    return index


def _ascii_neighbour(chars: list[str], position: int, size: int) -> bool:
    before = chars[position - 1] if position > 0 else ""
    after = chars[position + size] if position + size < len(chars) else ""
    return (before.isascii() and before.isalpha()) or (after.isascii() and after.isalpha())


def _spans(chars: list[str], index: PatternIndex) -> list[tuple[int, int, str]]:
    spans: list[tuple[int, int, str]] = []
    position = 0
    while position < len(chars):
        for term, readings in index.get(primary_reading(chars[position]), ()):
            size = len(term)
            if position + size > len(chars):
                continue
            if "".join(chars[position : position + size]) == term:
                position += size
                break
            if term.isascii() and _ascii_neighbour(chars, position, size):
                continue
            if all(
                primary_reading(chars[position + offset]) == readings[offset]
                for offset in range(1, size)
            ):
                spans.append((position, size, term))
                position += size
                break
        else:
            position += 1
    return spans


def normalize_text(text: str, index: PatternIndex) -> str:
    if not index or len(text) < 2:
        return text
    chars = list(text)
    spans = _spans(chars, index)
    if not spans:
        return text
    for start, size, term in spans:
        chars[start : start + size] = list(term)
    return "".join(chars)


def normalize_segment(segment: AsrSegment, index: PatternIndex) -> None:
    """Rewrite glossary homophones in ASR output; timing and confidence stay untouched."""
    if not index:
        return
    if segment.words:
        chars = list("".join(word.text for word in segment.words))
        spans = _spans(chars, index)
        if spans:
            for start, size, term in spans:
                chars[start : start + size] = list(term)
            position = 0
            for word in segment.words:
                size = len(word.text)
                word.text = "".join(chars[position : position + size])
                position += size
    segment.text = normalize_text(segment.text, index)
