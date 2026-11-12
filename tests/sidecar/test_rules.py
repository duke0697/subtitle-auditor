from app.align import align
from app.config import DEFAULT_OPTIONS
from app.rules import build_findings, build_summary
from app.schema import AsrSegment, AsrWord, Cue


def cue(index: int, start: int, text: str, duration: int = 2000) -> Cue:
    return Cue(id=f"cue-{index}", index=index, start_ms=start, end_ms=start + duration, text=text)


def segment(index: int, text: str, probability: float = 0.98, avg: float = -0.1) -> AsrSegment:
    word = AsrWord(
        id=f"w-{index}-0",
        text=text,
        start_ms=0,
        end_ms=2000,
        probability=probability,
        segment_id=f"seg-{index}",
    )
    return AsrSegment(
        id=f"seg-{index}",
        start_ms=0,
        end_ms=2000,
        text=text,
        avg_logprob=avg,
        no_speech_prob=0.05,
        words=[word],
    )


def segment_span(index: int, text: str, start: int, end: int) -> AsrSegment:
    word = AsrWord(
        id=f"w-{index}-0",
        text=text,
        start_ms=start,
        end_ms=end,
        probability=0.98,
        segment_id=f"seg-{index}",
    )
    return AsrSegment(
        id=f"seg-{index}",
        start_ms=start,
        end_ms=end,
        text=text,
        avg_logprob=-0.1,
        no_speech_prob=0.05,
        words=[word],
    )


def analyze(cue_text: str, asr_text: str, probability: float = 0.98, avg: float = -0.1):
    cues = [cue(0, 0, cue_text)]
    segments = [segment(0, asr_text, probability, avg)]
    bundle = align(cues, segments, DEFAULT_OPTIONS)
    findings = build_findings(cues, segments, bundle, DEFAULT_OPTIONS)
    summary = build_summary(cues, segments, bundle, findings, 2000)
    return findings, summary


def test_typo_detected_with_high_confidence():
    findings, _ = analyze("我在家里", "我再家里")
    typos = [item for item in findings if item.kind == "typo"]
    assert len(typos) == 1
    assert typos[0].suggestion == "再"
    assert typos[0].evidence.pinyin is not None
    assert typos[0].evidence.pinyin.similarity == 1.0


def test_polyphone_typo_detected():
    findings, _ = analyze("取出万用表并校表", "取出万用表并叫表")
    assert len([item for item in findings if item.kind == "typo"]) == 1


def test_low_confidence_downgrades_to_uncertain():
    findings, _ = analyze("我在家里", "我再家里", probability=0.6)
    assert not [item for item in findings if item.kind == "typo"]
    assert [item for item in findings if item.kind == "uncertain"]


def test_content_mismatch():
    findings, _ = analyze("今天下雨了", "明天天气晴")
    assert [item for item in findings if item.kind == "content"]


def test_inserted_asr_noise_is_not_content():
    findings, _ = analyze("工具及防护用品主要有", "工具及防火器互用品主要有")
    assert not [item for item in findings if item.kind == "content"]
    assert not [item for item in findings if item.kind == "typo"]
    assert any(item.title == "语音多识别" for item in findings)


def test_boundary_words_between_cues_are_not_content():
    cues = [
        cue(0, 0, "连接至示波器通道一", 2000),
        cue(1, 3500, "并锁紧将红色示波器探头", 3000),
        cue(2, 8000, "并按下按钮", 1500),
    ]
    segments = [
        segment_span(0, "连接至示波器通道1并", 0, 2500),
        segment_span(1, "锁紧将红色示波器探头并", 3500, 7000),
    ]
    bundle = align(cues, segments, DEFAULT_OPTIONS)
    findings = build_findings(cues, segments, bundle, DEFAULT_OPTIONS)
    assert not [item for item in findings if item.kind == "content"]


def test_single_missing_char_is_not_content():
    findings, _ = analyze("印有电压等级", "有电压等级")
    assert not [item for item in findings if item.kind == "content"]
    assert any(item.title == "语音边界差异" for item in findings)


def test_edge_delete_plus_insert_is_not_content():
    findings, _ = analyze("确保其连接可靠", "保其连接可靠。2.")
    assert not [item for item in findings if item.kind == "content"]
    assert any(item.title == "语音边界差异" for item in findings)


def test_missing_subtitle_words_stay_content():
    findings, _ = analyze("清除故障码后再次扫描", "清除故障码后")
    assert [item for item in findings if item.kind == "content"]


def test_summary_counts():
    findings, summary = analyze("我在家里", "我再家里")
    assert summary.counts["typo"] == len([item for item in findings if item.kind == "typo"])
    assert 0.0 <= summary.consistency <= 1.0
    assert summary.cue_count == 1
