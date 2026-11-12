from app.align import AlignmentBundle, align
from app.config import DEFAULT_OPTIONS
from app.schema import AsrSegment, AsrWord, Cue
from app.timing import build_timing_findings


def make_cue(index: int, start: int, text: str = "我们去看电影吧", duration: int = 900) -> Cue:
    return Cue(id=f"cue-{index}", index=index, start_ms=start, end_ms=start + duration, text=text)


def make_segment(index: int, start: int, text: str = "我们去看电影吧", duration: int = 900) -> AsrSegment:
    word = AsrWord(
        id=f"w-{index}-0",
        text=text,
        start_ms=start,
        end_ms=start + duration,
        probability=0.98,
        segment_id=f"seg-{index}",
    )
    return AsrSegment(
        id=f"seg-{index}",
        start_ms=start,
        end_ms=start + duration,
        text=text,
        avg_logprob=-0.1,
        no_speech_prob=0.05,
        words=[word],
    )


def test_global_offset_finding():
    cues = [make_cue(i, 2000 + i * 2000, f"第{i}句台词内容") for i in range(12)]
    segments = [make_segment(i, i * 2000, f"第{i}句台词内容") for i in range(12)]
    bundle = align(cues, segments, DEFAULT_OPTIONS)
    findings = build_timing_findings(cues, segments, bundle, DEFAULT_OPTIONS)
    assert any(item.id == "timing-global-offset" for item in findings)


def test_local_drift_finding():
    cues = [make_cue(0, 0)]
    segments = [make_segment(0, 2000)]
    bundle = align(cues, segments, DEFAULT_OPTIONS)
    findings = build_timing_findings(cues, segments, bundle, DEFAULT_OPTIONS)
    assert any(item.kind == "timing" and item.cue_ids for item in findings)


def test_drift_within_tolerance_is_ignored():
    cues = [make_cue(0, 0)]
    segments = [make_segment(0, 400)]
    bundle = align(cues, segments, DEFAULT_OPTIONS)
    findings = build_timing_findings(cues, segments, bundle, DEFAULT_OPTIONS)
    assert not any(item.cue_ids for item in findings)


def test_drift_above_tolerance_is_reported():
    cues = [make_cue(0, 0)]
    segments = [make_segment(0, 700)]
    bundle = align(cues, segments, DEFAULT_OPTIONS)
    findings = build_timing_findings(cues, segments, bundle, DEFAULT_OPTIONS)
    assert any(item.cue_ids for item in findings)


def test_tolerance_is_configurable():
    cues = [make_cue(0, 0)]
    segments = [make_segment(0, 700)]
    bundle = align(cues, segments, DEFAULT_OPTIONS)
    options = {**DEFAULT_OPTIONS, "timingToleranceMs": 1000}
    findings = build_timing_findings(cues, segments, bundle, options)
    assert not any(item.cue_ids for item in findings)


def test_edge_truncation_suppresses_timing():
    cues = [make_cue(0, 0, "确保其连接可靠", 2000)]
    segments = [make_segment(0, 800, "保其连接可靠", 1200)]
    bundle = align(cues, segments, DEFAULT_OPTIONS)
    findings = build_timing_findings(cues, segments, bundle, DEFAULT_OPTIONS)
    assert not any(item.cue_ids for item in findings)


def test_global_offset_reported_even_when_spread_is_large():
    bundle = AlignmentBundle(
        alignments=[],
        global_offset_ms=1800,
        anchors=40,
        drift_ms_per_minute=None,
        drift_total_ms=None,
        offset_mad_ms=520,
    )
    findings = build_timing_findings([], [], bundle, DEFAULT_OPTIONS)
    message = findings[0].message
    assert findings[0].title == "字幕整体时间偏移"
    assert "晚于" in message
    assert "±520" in message
