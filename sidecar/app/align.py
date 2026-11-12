from __future__ import annotations

import bisect
import difflib
import re
import statistics
import unicodedata
from dataclasses import dataclass, field
from typing import Optional

from rapidfuzz import fuzz

from .schema import AsrSegment, AsrWord, Cue, EditOp

try:
    from opencc import OpenCC

    _T2S = OpenCC("t2s")
except Exception:  # noqa: BLE001 - optional conversion
    _T2S = None


@dataclass
class CueAlignment:
    cue_ids: list[str]
    start_ms: int
    end_ms: int
    sub_text: str
    asr_text: str
    ratio: float
    opcodes: list[tuple[str, int, int, int, int]] = field(default_factory=list)
    edits: list[EditOp] = field(default_factory=list)
    sub_norm: str = ""
    asr_norm: str = ""
    sub_map: list[int] = field(default_factory=list)
    asr_map: list[int] = field(default_factory=list)
    asr_word_ids: list[Optional[str]] = field(default_factory=list)
    first_word_start_ms: Optional[int] = None
    last_word_end_ms: Optional[int] = None
    words: list[AsrWord] = field(default_factory=list)
    merged: bool = False


@dataclass
class AlignmentBundle:
    alignments: list[CueAlignment]
    global_offset_ms: Optional[int]
    anchors: int
    drift_ms_per_minute: Optional[float]
    drift_total_ms: Optional[float]
    offset_mad_ms: Optional[int] = None


def simplify(text: str) -> str:
    return _T2S.convert(text) if _T2S is not None else text


_DIGIT_MAP = str.maketrans("零一二三四五六七八九两", "01234567892")
_FULLWIDTH = {code: code - 0xFEE0 for code in range(0xFF01, 0xFF5F)}

_UNIT_WORDS = {
    "%": "百分之",
    "Ω": "欧",
    "欧姆": "欧",
    "℃": "摄氏度",
    "°C": "摄氏度",
    "V": "伏",
    "mV": "毫伏",
    "kV": "千伏",
    "A": "安",
    "mA": "毫安",
    "mAh": "毫安时",
    "W": "瓦",
    "kW": "千瓦",
    "kWh": "千瓦时",
    "kW·h": "千瓦时",
    "kW.h": "千瓦时",
    "kΩ": "千欧",
    "MΩ": "兆欧",
    "μF": "微法",
    "nF": "纳法",
    "mH": "毫亨",
    "kHz": "千赫兹",
    "mm²": "平方",
    "mm2": "平方",
    "cm²": "平方厘米",
    "m²": "平方米",
    "cm": "厘米",
    "mL": "毫升",
    "r/min": "转每分钟",
    "rpm": "转每分钟",
    "Nm": "牛米",
    "kg": "千克",
    "L": "升",
    "g": "克",
    "t": "吨",
    "bar": "巴",
    "mm": "毫米",
    "m": "米",
    "km": "公里",
    "km/h": "公里每小时",
    "N·m": "牛米",
    "N.m": "牛米",
    "MPa": "兆帕",
    "kPa": "千帕",
    "Hz": "赫兹",
    "Ah": "安时",
    "°": "度",
}
_PREFIX_UNITS = {"%"}
_UNIT_PATTERN = re.compile(
    r"(?P<num>\d+(?:\.\d+)?)\s*(?P<unit>"
    + "|".join(re.escape(unit) for unit in sorted(_UNIT_WORDS, key=len, reverse=True))
    + r")"
)

_CN_DIGITS = {"零": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
_CN_UNITS = {"十": 10, "百": 100, "千": 1000, "万": 10000}
_CN_NUM = r"[零一二三四五六七八九十百千万两]+"
_CN_NUM_LAZY = r"[零一二三四五六七八九十百千万两]+?"
_CN_UNIT_WORDS = (
    "平方毫米|平方厘米|平方米|千瓦时|千瓦|千伏|千欧|兆欧|千赫兹|千米|千克|"
    "毫安时|毫安|毫伏|毫亨|毫升|微法|纳法|转每分钟|伏特|安培|瓦特|欧姆|摄氏度|"
    "毫米|厘米|公里|牛米|兆帕|千帕|赫兹|安时|升|克|吨|巴|伏|安|瓦|欧|米|度"
)
_CN_UNIT_PATTERN = re.compile(rf"(?<!\d)({_CN_NUM_LAZY})({_CN_UNIT_WORDS})")
_CN_UNIT_ALIASES = {"千米": "公里", "平方毫米": "平方"}
_PERCENT_CN_PATTERN = re.compile(rf"百分之({_CN_NUM})")
_CAN_DIFF = re.compile(r"(?i)can[-_\s]?([hl])(?![a-z])")
_CAN_WORDS = {"h": "高", "l": "低"}
_DECIMAL_DOT = re.compile(r"(?<=\d)\.(?=\d)")
_NUMBER_RANGE = re.compile(r"(?<=\d)\s*[-~～至]\s*(?=\d)")


def _cn_number(text: str) -> int:
    total = section = number = 0
    for char in text:
        if char in _CN_DIGITS:
            number = _CN_DIGITS[char]
            continue
        unit = _CN_UNITS[char]
        if unit == 10000:
            total += (section + number) * unit
            section = 0
        else:
            section += (number or 1) * unit
        number = 0
    return total + section + number


def _rewrite(text: str, pattern: re.Pattern[str], build) -> tuple[str, list[int]]:
    output: list[str] = []
    source: list[int] = []
    position = 0
    for match in pattern.finditer(text):
        for index in range(position, match.start()):
            output.append(text[index])
            source.append(index)
        for char in build(match):
            output.append(char)
            source.append(match.start())
        position = match.end()
    for index in range(position, len(text)):
        output.append(text[index])
        source.append(index)
    return "".join(output), source


def _canonical(text: str) -> tuple[str, list[int]]:
    """Rewrite written units to the spoken form while keeping original offsets."""
    text, first = _rewrite(
        text,
        _CN_UNIT_PATTERN,
        lambda m: f"{_cn_number(m.group(1))}{_CN_UNIT_ALIASES.get(m.group(2), m.group(2))}",
    )
    text, second = _rewrite(text, _PERCENT_CN_PATTERN, lambda m: f"百分之{_cn_number(m.group(1))}")
    text, third = _rewrite(
        text,
        _UNIT_PATTERN,
        lambda m: (
            f"百分之{m.group('num')}"
            if m.group("unit") in _PREFIX_UNITS
            else f"{m.group('num')}{_UNIT_WORDS[m.group('unit')]}"
        ),
    )
    text, fourth = _rewrite(text, _DECIMAL_DOT, lambda m: "点")
    text, fifth = _rewrite(text, _NUMBER_RANGE, lambda m: "到")
    source = [first[index] for index in second]
    source = [source[index] for index in third]
    source = [source[index] for index in fourth]
    source = [source[index] for index in fifth]
    return text, source
_OHM_SIGNS = {"Ω", "ω", "Ω"}


def normalize(text: str, t2s: bool = True) -> tuple[str, list[int]]:
    converted = text
    if t2s and _T2S is not None:
        candidate = _T2S.convert(text)
        if len(candidate) == len(text):
            converted = candidate
    converted = converted.translate(_FULLWIDTH)
    converted, can_source = _rewrite(
        converted, _CAN_DIFF, lambda match: f"CAN{_CAN_WORDS[match.group(1).lower()]}"
    )
    canonical, source = _canonical(converted)
    source = [can_source[index] for index in source]
    output: list[str] = []
    mapping: list[int] = []
    for index, char in enumerate(canonical):
        if char in _OHM_SIGNS:
            char = "欧"
        elif char == "±":
            output.extend(("正", "负"))
            mapping.extend((source[index], source[index]))
            continue
        code = ord(char)
        if 0x2460 <= code <= 0x2473:
            for part in str(code - 0x2460 + 1):
                output.append(part)
                mapping.append(source[index])
            continue
        category = unicodedata.category(char)
        if category[0] in {"P", "Z", "C", "S"}:
            continue
        if not (char.isalnum() or "一" <= char <= "鿿"):
            continue
        if not char.isascii():
            char = char.translate(_DIGIT_MAP)
        output.append(char.lower() if char.isascii() else char)
        mapping.append(source[index])
    return "".join(output), mapping


def _flatten(segments: list[AsrSegment]) -> list[AsrWord]:
    words: list[AsrWord] = []
    for segment in segments:
        words.extend(segment.words)
    words.sort(key=lambda word: (word.start_ms, word.end_ms))
    return words


def _asr_view(words: list[AsrWord]) -> tuple[str, str, list[int], list[Optional[str]]]:
    parts: list[str] = []
    raw_word_ids: list[int] = []
    for index, word in enumerate(words):
        parts.append(word.text)
        raw_word_ids.extend([index] * len(word.text))
    raw = "".join(parts)
    norm, mapping = normalize(raw)
    word_ids = [
        words[raw_word_ids[position]].id if position < len(raw_word_ids) else None
        for position in mapping
    ]
    return raw, norm, mapping, word_ids


def _candidate_indices(words: list[AsrWord], start: int, end: int, tolerance: int, minimum: int) -> list[int]:
    low, high = start - tolerance, end + tolerance
    result: list[int] = []
    for index, word in enumerate(words):
        if index < minimum:
            continue
        midpoint = (word.start_ms + word.end_ms) / 2
        if low <= midpoint <= high:
            result.append(index)
        elif word.start_ms <= high and word.end_ms >= low:
            result.append(index)
    return result


def _evaluate(
    cues: list[Cue],
    words: list[AsrWord],
    tolerances: tuple[int, ...],
    minimum: int,
    offset: int,
    t2s: bool,
) -> tuple[float, float, list[int]]:
    start = cues[0].start_ms - offset
    end = cues[-1].end_ms - offset
    sub_norm, _ = normalize(" ".join(cue.text for cue in cues), t2s)
    duration = max(1, end - start)
    best: Optional[tuple[float, float, float, list[int]]] = None

    for tolerance in tolerances:
        candidates = _candidate_indices(words, start, end, tolerance, minimum)
        if not candidates:
            continue
        norm_cache = {index: normalize(words[index].text, t2s)[0] for index in candidates}
        if len(candidates) > 36:
            runs = [candidates]
        else:
            runs = [
                candidates[first : first + length]
                for first in range(len(candidates))
                for length in range(1, len(candidates) - first + 1)
            ]
        for run in runs:
            asr_norm = "".join(norm_cache[index] for index in run)
            if not asr_norm:
                continue
            ratio = fuzz.ratio(sub_norm, asr_norm)
            # fuzz.ratio rewards dropping mismatching words; score against the longer text instead.
            matches = ratio * (len(sub_norm) + len(asr_norm)) / 200.0
            ratio = 100.0 * matches / max(len(sub_norm), len(asr_norm))
            asr_start = min(words[index].start_ms for index in run)
            asr_end = max(words[index].end_ms for index in run)
            overlap = max(0, min(end, asr_end) - max(start, asr_start)) / duration
            outside = sum(
                1
                for index in run
                if words[index].end_ms < start or words[index].start_ms > end
            )
            score = 0.85 * ratio + 15 * overlap - 8 * outside + 0.05 * len(asr_norm)
            if best is None or score > best[0]:
                best = (score, ratio, overlap, run)
        # A narrow window that already explains the subtitle well is not widened.
        if best is not None and best[1] >= 88:
            break

    if best is None or not sub_norm:
        candidates = _candidate_indices(words, start, end, tolerances[0], minimum)
        return 0.0, 0.0, candidates
    _, ratio, overlap, run = best
    if ratio < 25 and overlap < 0.3:
        return 0.0, 0.0, []
    return ratio, overlap, run


def _build_alignment(
    cues: list[Cue],
    words: list[AsrWord],
    indices: list[int],
    ratio: float,
    t2s: bool,
    merged: bool,
) -> CueAlignment:
    sub_text = " ".join(cue.text for cue in cues)
    sub_norm, sub_map = normalize(sub_text, t2s)
    if indices:
        selected = [words[index] for index in indices]
        asr_raw, asr_norm, asr_map, asr_word_ids = _asr_view(selected)
        first_start = min(word.start_ms for word in selected)
        last_end = max(word.end_ms for word in selected)
    else:
        selected = []
        asr_raw, asr_norm, asr_map, asr_word_ids = "", "", [], []
        first_start = None
        last_end = None

    opcodes: list[tuple[str, int, int, int, int]] = []
    edits: list[EditOp] = []
    if sub_norm and asr_norm:
        matcher = difflib.SequenceMatcher(None, sub_norm, asr_norm, autojunk=False)
        for tag, i1, i2, j1, j2 in matcher.get_opcodes():
            opcodes.append((tag, i1, i2, j1, j2))
            if tag == "equal":
                continue
            sub_start = sub_map[i1] if i1 < len(sub_map) else len(sub_text)
            sub_end = (sub_map[i2 - 1] + 1) if i2 > i1 else sub_start
            asr_start = asr_map[j1] if j1 < len(asr_map) else len(asr_raw)
            asr_end = (asr_map[j2 - 1] + 1) if j2 > j1 else asr_start
            edits.append(
                EditOp(
                    op=tag,
                    sub_start=sub_start,
                    sub_end=sub_end,
                    asr_start=asr_start,
                    asr_end=asr_end,
                    sub_text=sub_text[sub_start:sub_end],
                    asr_text=asr_raw[asr_start:asr_end],
                )
            )

    return CueAlignment(
        cue_ids=[cue.id for cue in cues],
        start_ms=cues[0].start_ms,
        end_ms=cues[-1].end_ms,
        sub_text=sub_text,
        asr_text=asr_raw,
        ratio=ratio,
        opcodes=opcodes,
        edits=edits,
        sub_norm=sub_norm,
        asr_norm=asr_norm,
        sub_map=sub_map,
        asr_map=asr_map,
        asr_word_ids=asr_word_ids,
        first_word_start_ms=first_start,
        last_word_end_ms=last_end,
        words=selected,
        merged=merged,
    )


def _estimate_global_offset(
    cues: list[Cue],
    words: list[AsrWord],
    threshold_ms: int,
    t2s: bool,
) -> tuple[Optional[int], int, Optional[int], list[tuple[int, int]]]:
    drifts: list[int] = []
    anchors: list[tuple[int, int]] = []
    for cue in cues:
        indices = _candidate_indices(words, cue.start_ms, cue.end_ms, 3000, 0)
        sub_norm, _ = normalize(cue.text, t2s)
        if not indices or not sub_norm:
            continue
        best_ratio = -1.0
        best_index: Optional[int] = None
        for anchor_index in indices:
            limit = words[anchor_index].start_ms + (cue.end_ms - cue.start_ms) + 600
            run = [
                index
                for index in indices
                if words[anchor_index].start_ms - 100 <= words[index].start_ms <= limit
            ]
            asr_text = "".join(words[index].text for index in run)
            asr_norm, _ = normalize(asr_text, t2s)
            if not asr_norm:
                continue
            ratio = fuzz.ratio(sub_norm, asr_norm)
            if ratio > best_ratio:
                best_ratio = ratio
                best_index = anchor_index
        if best_index is None or best_ratio < 70:
            continue
        drift = cue.start_ms - words[best_index].start_ms
        drifts.append(drift)
        anchors.append((cue.start_ms, drift))
    if len(drifts) < 10:
        return None, len(drifts), None, anchors
    median = statistics.median(drifts)
    mad = int(statistics.median(abs(value - median) for value in drifts))
    if abs(median) >= threshold_ms:
        return int(median), len(drifts), mad, anchors
    return None, len(drifts), mad, anchors


def _drift_slope(anchors: list[tuple[int, int]]) -> tuple[Optional[float], Optional[float]]:
    if len(anchors) < 10:
        return None, None
    span = anchors[-1][0] - anchors[0][0]
    if span < 60_000:
        return None, None
    xs = [time / 60_000 for time, _ in anchors]
    ys = [drift for _, drift in anchors]
    try:
        slope, _ = statistics.linear_regression(xs, ys)
    except statistics.StatisticsError:
        return None, None
    total = slope * ((xs[-1] - xs[0]) or 0)
    return float(slope), float(total)


def align(
    cues: list[Cue],
    segments: list[AsrSegment],
    options: dict,
) -> AlignmentBundle:
    words = _flatten(segments)
    starts = [word.start_ms for word in words]
    t2s = bool(options.get("t2s", True))
    offset, anchor_count, offset_mad, anchors = _estimate_global_offset(
        cues, words, int(options.get("globalOffsetMs", 500)), t2s
    )
    effective_offset = offset or 0
    slope, total = _drift_slope(anchors)

    alignments: list[CueAlignment] = []
    minimum = 0
    index = 0
    while index < len(cues):
        best: Optional[tuple[float, float, int, list[int]]] = None
        single_ratio = 0.0
        max_group = 1
        while (
            max_group < 3
            and index + max_group < len(cues)
            and cues[index + max_group].start_ms - cues[index + max_group - 1].end_ms <= 1200
        ):
            max_group += 1

        for size in range(1, max_group + 1):
            group = cues[index : index + size]
            ratio, overlap, indices = _evaluate(
                group, words, (600, 3000), minimum, effective_offset, t2s
            )
            score = 0.85 * ratio + 15 * overlap
            if size == 1:
                single_ratio = ratio
            if best is None or score > best[0]:
                best = (score, ratio, size, indices)

        assert best is not None
        _, ratio, size, indices = best
        if size > 1 and not (ratio >= 60 and ratio - single_ratio >= 8):
            size = 1
            ratio, _, indices = _evaluate(
                cues[index : index + 1], words, (600, 3000), minimum, effective_offset, t2s
            )

        group = cues[index : index + size]
        alignments.append(
            _build_alignment(group, words, indices, ratio, t2s, merged=size > 1)
        )
        # The cursor must live in ASR time, otherwise a global offset makes every cue
        # eat the words that belong to the next one.
        minimum = bisect.bisect_left(starts, group[-1].end_ms - effective_offset)
        index += size

    return AlignmentBundle(
        alignments=alignments,
        global_offset_ms=offset,
        anchors=anchor_count,
        drift_ms_per_minute=slope,
        drift_total_ms=total,
        offset_mad_ms=offset_mad,
    )
