from app.align import align
from app.config import DEFAULT_OPTIONS
from app.rules import build_findings, build_summary
from app.schema import AsrSegment, AsrWord, Cue


def cue(index: int, start: int, text: str, duration: int = 2000) -> Cue:
    return Cue(id=f"cue-{index}", index=index, start_ms=start, end_ms=start + duration, text=text)


def segment(
    index: int, text: str, probability: float = 0.98, avg: float = -0.1, no_speech: float = 0.05
) -> AsrSegment:
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
        no_speech_prob=no_speech,
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


def analyze(
    cue_text: str,
    asr_text: str,
    probability: float = 0.98,
    avg: float = -0.1,
    no_speech: float = 0.05,
):
    cues = [cue(0, 0, cue_text)]
    segments = [segment(0, asr_text, probability, avg, no_speech)]
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


def test_window_no_speech_alone_is_not_low_confidence():
    # no_speech_prob belongs to a whole 30s window; a clean decode must not be flagged.
    findings, _ = analyze("首先打开点火开关", "首先打开点火开关", avg=-0.07, no_speech=0.61)
    assert not [item for item in findings if item.title == "ASR 置信度较低"]


def test_low_logprob_is_still_flagged():
    findings, _ = analyze("检查实训环境", "检查实训环境", avg=-1.4, no_speech=0.2)
    assert [item for item in findings if item.title == "ASR 置信度较低"]


def test_mixed_script_difference_is_term_mismatch_not_content():
    findings, _ = analyze("高压互锁输出HVIL-out端子", "高压互锁输出或VLDout端子")
    assert not [item for item in findings if item.kind == "content"]
    assert [item for item in findings if item.title == "术语识别差异"]


def test_clean_letter_swap_is_content_difference():
    # The narration of the sampled course really says CAN-D where the subtitle says CAN-L.
    findings, _ = analyze("检测PDU和VCU之间CAN-L线路的电阻", "检测PDU和VCU之间CAND线路的电阻")
    letter = [item for item in findings if item.title == "字母写法不一致"]
    assert len(letter) == 1
    assert letter[0].kind == "content"
    assert letter[0].severity == "review"
    assert "CAN-L" in letter[0].message and "CAND" in letter[0].message
    assert not [item for item in findings if item.title == "术语识别差异"]


def test_garbled_acronym_stays_term_difference():
    findings, _ = analyze("压互锁输入HVIL-in端子", "压互锁输入PVL-E端子")
    assert not [item for item in findings if item.kind == "content"]
    assert [item for item in findings if item.title == "术语识别差异"]


def test_consistent_subtitle_spelling_demotes_typo():
    cues = [
        cue(0, 0, "将接地夹连接至负极"),
        cue(1, 3000, "另一接地夹连接至正极"),
        cue(2, 6000, "测量接地夹电压"),
    ]
    segments = [
        segment_span(0, "将接地加连接至负极", 0, 2000),
        segment_span(1, "另一接地夹连接至正极", 3000, 5000),
        segment_span(2, "测量接地夹电压", 6000, 8000),
    ]
    bundle = align(cues, segments, DEFAULT_OPTIONS)
    findings = build_findings(cues, segments, bundle, DEFAULT_OPTIONS)
    assert not [item for item in findings if item.kind == "typo"]
    assert [item for item in findings if item.title == "同音差异（疑似 ASR 误识）"]


def test_unique_subtitle_spelling_is_review_typo():
    cues = [cue(0, 0, "今天天气很号我们出去走走吧"), cue(1, 3000, "好呀我想去公园看看")]
    segments = [
        segment_span(0, "今天天气很好我们出去走走吧", 0, 2000),
        segment_span(1, "好呀我想去公园看看", 3000, 5000),
    ]
    bundle = align(cues, segments, DEFAULT_OPTIONS)
    findings = build_findings(cues, segments, bundle, DEFAULT_OPTIONS)
    typos = [item for item in findings if item.kind == "typo"]
    assert len(typos) == 1
    assert typos[0].severity == "review"
    assert typos[0].suggestion == "好"


def test_subtitle_corroborated_spelling_is_high_typo():
    cues = [
        cue(0, 0, "今天天气很好"),
        cue(1, 3000, "明天天气很好"),
        cue(2, 6000, "今天天气很号"),
    ]
    segments = [
        segment_span(0, "今天天气很好", 0, 2000),
        segment_span(1, "明天天气很好", 3000, 5000),
        segment_span(2, "今天天气很好", 6000, 8000),
    ]
    bundle = align(cues, segments, DEFAULT_OPTIONS)
    findings = build_findings(cues, segments, bundle, DEFAULT_OPTIONS)
    typos = [item for item in findings if item.kind == "typo"]
    assert len(typos) == 1
    assert typos[0].severity == "high"


def test_confusion_only_reading_is_uncertain_not_typo():
    # yin4/ying1 is a classic ASR confusion; it cannot assert a subtitle typo.
    findings, _ = analyze("检查手套表面印有电压等级", "检查手套表面应有电压等级")
    assert not [item for item in findings if item.kind == "typo"]
    near = [item for item in findings if item.title == "近音差异（疑似 ASR 误识）"]
    assert len(near) == 1
    assert near[0].severity == "info"


def test_incidental_character_does_not_corroborate_typo():
    cues = [
        cue(0, 0, "将插头插入插座"),
        cue(1, 3000, "先确认差分基准电压"),
        cue(2, 6000, "差分电压缺失"),
    ]
    segments = [
        segment_span(0, "将插头插入插座", 0, 2000),
        segment_span(1, "先确认差分基准电压", 3000, 5000),
        segment_span(2, "插分电压缺失", 6000, 8000),
    ]
    bundle = align(cues, segments, DEFAULT_OPTIONS)
    findings = build_findings(cues, segments, bundle, DEFAULT_OPTIONS)
    assert not [item for item in findings if item.kind == "typo"]
    demoted = [item for item in findings if item.title == "同音差异（疑似 ASR 误识）"]
    assert len(demoted) == 1
    assert demoted[0].severity == "info"


def test_repeated_edit_in_one_group_is_one_finding():
    cues = [cue(0, 0, "甲号乙丙丁戊己号辛壬癸", 2000)]
    segments = [segment_span(0, "甲好乙丙丁戊己好辛壬癸", 0, 2000)]
    bundle = align(cues, segments, DEFAULT_OPTIONS)
    findings = build_findings(cues, segments, bundle, DEFAULT_OPTIONS)
    typos = [item for item in findings if item.kind == "typo"]
    assert len(typos) == 1
    assert len(typos[0].evidence.edits) == 2


def test_boundary_repeat_with_split_can_label_is_not_content():
    cues = [
        cue(0, 0, "绿色线连接到VCU模块的CAN-L端子"),
        cue(1, 3000, "将这组CAN通讯线束另一端的蓝色线"),
    ]
    segments = [
        segment_span(0, "绿色线连接到VCU模块的CAN-L端子", 0, 2000),
        segment_span(1, "L端子。将这组CAN通讯线束另一端的蓝色线", 3000, 5000),
    ]
    bundle = align(cues, segments, DEFAULT_OPTIONS)
    findings = build_findings(cues, segments, bundle, DEFAULT_OPTIONS)
    assert not [item for item in findings if item.kind == "content"]


def test_delete_at_cue_wrap_is_not_content():
    cues = [
        cue(0, 0, "将这组CAN通讯线束另一", 2000),
        cue(1, 2000, "一端的蓝色线", 3000),
    ]
    segments = [segment_span(0, "将这组CAN通讯线束另一端的蓝色线", 0, 4000)]
    bundle = align(cues, segments, DEFAULT_OPTIONS)
    findings = build_findings(cues, segments, bundle, DEFAULT_OPTIONS)
    assert not [item for item in findings if item.kind == "content"]
    assert any(item.title == "字幕断句差异" for item in findings)


def test_content_beside_typo_is_still_reported():
    findings, _ = analyze("接地夹测量电压", "接地加测量电阻")
    assert [item for item in findings if item.kind == "typo"]
    assert [item for item in findings if item.kind == "content"]


def test_subtitle_internal_inconsistency_upgrades_typo_in_noisy_group():
    cues = [
        cue(0, 0, "刹车开关侧的端子"),
        cue(1, 3500, "上电开关测的端子"),
        cue(2, 7000, "档位开关侧的端子"),
    ]
    segments = [
        segment_span(0, "刹车开关侧的端子", 0, 2000),
        segment_span(1, "上电开关侧的START端子", 3500, 5500),
        segment_span(2, "档位开关侧的端子", 7000, 9000),
    ]
    bundle = align(cues, segments, DEFAULT_OPTIONS)
    findings = build_findings(cues, segments, bundle, DEFAULT_OPTIONS)
    typos = [item for item in findings if item.kind == "typo" and item.evidence.edits[0].sub_text == "测"]
    assert len(typos) == 1
    assert typos[0].severity == "high"
    assert typos[0].suggestion == "侧"


def test_glossary_term_blocks_homophone_demotion():
    options = {**DEFAULT_OPTIONS, "glossary": ["高压互锁"]}
    cues = [cue(0, 0, "检查高压互索端子"), cue(1, 3000, "高压互索采用串联方式")]
    segments = [
        segment_span(0, "检查高压互锁端子", 0, 2000),
        segment_span(1, "高压互锁采用串联方式", 3000, 5000),
    ]
    bundle = align(cues, segments, options)
    findings = build_findings(cues, segments, bundle, options)
    typos = [item for item in findings if item.kind == "typo"]
    assert len(typos) == 2
    assert all(item.suggestion == "锁" for item in typos)
    assert all(item.severity == "high" for item in typos)
