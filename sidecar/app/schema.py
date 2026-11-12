from __future__ import annotations

from dataclasses import dataclass, field, fields, is_dataclass
from typing import Any, Optional


def _camel(name: str) -> str:
    head, *tail = name.split("_")
    return head + "".join(part.title() for part in tail)


def jsonable(value: Any) -> Any:
    if is_dataclass(value):
        return {_camel(f.name): jsonable(getattr(value, f.name)) for f in fields(value)}
    if isinstance(value, (list, tuple)):
        return [jsonable(item) for item in value]
    if isinstance(value, dict):
        return {key: jsonable(item) for key, item in value.items()}
    return value


@dataclass
class Cue:
    id: str
    index: int
    start_ms: int
    end_ms: int
    text: str


@dataclass
class AsrWord:
    id: str
    text: str
    start_ms: int
    end_ms: int
    probability: float
    segment_id: str


@dataclass
class AsrSegment:
    id: str
    start_ms: int
    end_ms: int
    text: str
    avg_logprob: float
    no_speech_prob: float
    words: list[AsrWord] = field(default_factory=list)


@dataclass
class EditOp:
    op: str
    sub_start: int
    sub_end: int
    asr_start: int
    asr_end: int
    sub_text: str
    asr_text: str


@dataclass
class PinyinEvidence:
    sub: list[str]
    asr: list[str]
    similarity: float
    relation: str


@dataclass
class TimingEvidence:
    start_drift_ms: int
    end_drift_ms: int
    global_offset_ms: Optional[int]


@dataclass
class Evidence:
    edits: list[EditOp] = field(default_factory=list)
    words: list[dict[str, Any]] = field(default_factory=list)
    pinyin: Optional[PinyinEvidence] = None
    timing: Optional[TimingEvidence] = None
    note: Optional[str] = None


@dataclass
class Finding:
    id: str
    kind: str
    severity: str
    cue_ids: list[str]
    start_ms: int
    end_ms: int
    title: str
    message: str
    subtitle_text: str
    asr_text: str
    confidence: Optional[float] = None
    suggestion: Optional[str] = None
    evidence: Evidence = field(default_factory=Evidence)


@dataclass
class Summary:
    duration_ms: int
    cue_count: int
    matched_cue_count: int
    consistency: float
    avg_confidence: float
    counts: dict[str, int]
    global_offset_ms: Optional[int]
    drift_ms_per_minute: Optional[float]


@dataclass
class AnalysisResult:
    schema_version: int
    created_at: str
    media: dict[str, Any]
    subtitle: dict[str, Any]
    model: dict[str, Any]
    cues: list[Cue]
    segments: list[AsrSegment]
    findings: list[Finding]
    summary: Summary
    options: dict[str, Any]
