from app.align import align, normalize
from app.config import DEFAULT_OPTIONS
from app.schema import AsrSegment, AsrWord, Cue


def make_cue(index: int, start: int, text: str, duration: int = 900) -> Cue:
    return Cue(id=f"cue-{index}", index=index, start_ms=start, end_ms=start + duration, text=text)


def make_segment(
    index: int,
    start: int,
    text: str,
    duration: int = 900,
    probability: float = 0.98,
    avg_logprob: float = -0.1,
    no_speech: float = 0.05,
) -> AsrSegment:
    word = AsrWord(
        id=f"w-{index}-0",
        text=text,
        start_ms=start,
        end_ms=start + duration,
        probability=probability,
        segment_id=f"seg-{index}",
    )
    return AsrSegment(
        id=f"seg-{index}",
        start_ms=start,
        end_ms=start + duration,
        text=text,
        avg_logprob=avg_logprob,
        no_speech_prob=no_speech,
        words=[word],
    )


def test_exact_match():
    cues = [make_cue(0, 0, "你好世界")]
    segments = [make_segment(0, 0, "你好世界")]
    bundle = align(cues, segments, DEFAULT_OPTIONS)
    assert bundle.alignments[0].ratio == 100.0
    assert bundle.global_offset_ms is None


def test_global_offset_detected():
    cues = [make_cue(i, 2000 + i * 2000, f"第{i}句台词内容") for i in range(12)]
    segments = [make_segment(i, i * 2000, f"第{i}句台词内容") for i in range(12)]
    bundle = align(cues, segments, DEFAULT_OPTIONS)
    assert bundle.global_offset_ms is not None
    assert abs(bundle.global_offset_ms - 2000) <= 100
    assert bundle.anchors >= 10


def test_missing_words():
    cues = [make_cue(0, 0, "这句没有语音")]
    segments = [make_segment(0, 10_000, "另一段话")]
    bundle = align(cues, segments, DEFAULT_OPTIONS)
    assert bundle.alignments[0].words == []


def test_merged_cues():
    cues = [
        make_cue(0, 0, "今天天气真的很好", 2800),
        make_cue(1, 3200, "我们出去走走", 2800),
    ]
    segments = [make_segment(0, 0, "今天天气真的很好我们出去走走", 6000)]
    bundle = align(cues, segments, DEFAULT_OPTIONS)
    assert len(bundle.alignments) == 1
    assert bundle.alignments[0].merged is True
    assert len(bundle.alignments[0].cue_ids) == 2


def test_edit_opcodes():
    cues = [make_cue(0, 0, "我在家里")]
    segments = [make_segment(0, 0, "我再家里")]
    bundle = align(cues, segments, DEFAULT_OPTIONS)
    edits = bundle.alignments[0].edits
    assert len(edits) == 1
    assert edits[0].sub_text == "在"
    assert edits[0].asr_text == "再"


def test_digit_and_numeral_are_equivalent():
    assert normalize("4个系统异常")[0] == normalize("四个系统异常")[0]
    assert normalize("４个")[0] == "4个"


def test_normalize_mapping_stays_aligned():
    norm, mapping = normalize("四个系统异常")
    assert len(norm) == len(mapping)
    assert mapping[0] == 0


def test_ohm_symbol_matches_spoken_unit():
    assert normalize("120Ω终端电阻")[0] == normalize("120欧终端电阻")[0]
    assert normalize("120Ω")[0] == normalize("120欧姆")[0]


def test_units_match_spoken_words():
    assert normalize("5V")[0] == normalize("五伏")[0]
    assert normalize("3kW")[0] == normalize("三千瓦")[0]
    assert normalize("25°C")[0] == normalize("25摄氏度")[0]
    assert normalize("5N·m")[0] == normalize("5牛米")[0]
    assert normalize("10km/h")[0] == normalize("10公里每小时")[0]


def test_percent_matches_spoken_prefix():
    assert normalize("80%")[0] == normalize("百分之八十")[0]
    assert normalize("80.5%")[0] == normalize("百分之八十点五")[0]


def test_decimal_matches_spoken_form():
    assert normalize("1.5V")[0] == normalize("一点五伏")[0]


def test_number_range_matches_spoken_form():
    assert normalize("8~10N·m")[0] == normalize("8到10牛米")[0]


def test_mass_and_volume_units():
    assert normalize("4L")[0] == normalize("四升")[0]
    assert normalize("500kg")[0] == normalize("五百千克")[0]
    assert normalize("10Nm")[0] == normalize("十牛米")[0]


def test_can_high_low_are_equivalent():
    assert normalize("CAN-H线路")[0] == normalize("CAN高线路")[0]
    assert normalize("CAN_L")[0] == normalize("CAN低")[0]
    assert normalize("CANH信号")[0] == normalize("CAN高信号")[0]


def test_prefix_and_gauge_units():
    assert normalize("500mA")[0] == normalize("五百毫安")[0]
    assert normalize("12kV")[0] == normalize("十二千伏")[0]
    assert normalize("2kΩ")[0] == normalize("两千欧")[0]
    assert normalize("5000mAh")[0] == normalize("五千毫安时")[0]
    assert normalize("3000r/min")[0] == normalize("三千转每分钟")[0]
    assert normalize("1.5mm²")[0] == normalize("一点五平方")[0]
    assert normalize("500mL")[0] == normalize("五百毫升")[0]


def test_fullwidth_and_symbol_forms():
    assert normalize("１２Ｖ")[0] == normalize("12V")[0]
    assert normalize("①")[0] == "1"
    assert normalize("±5")[0] == normalize("正负5")[0]


def test_keeps_mismatched_leading_word():
    cue = make_cue(0, 0, "印有电压等级", 2500)
    timeline = [("应", 100, 300), ("有", 300, 450), ("电", 450, 600), ("压", 600, 750), ("等", 750, 900), ("级", 900, 1100)]
    segment = AsrSegment(
        id="seg-0",
        start_ms=100,
        end_ms=1100,
        text="应有电压等级",
        avg_logprob=-0.1,
        no_speech_prob=0.05,
        words=[
            AsrWord(
                id=f"w-{index}",
                text=text,
                start_ms=start,
                end_ms=end,
                probability=0.99,
                segment_id="seg-0",
            )
            for index, (text, start, end) in enumerate(timeline)
        ],
    )
    bundle = align([cue], [segment], DEFAULT_OPTIONS)
    alignment = bundle.alignments[0]
    assert alignment.asr_text == "应有电压等级"
    assert alignment.edits[0].asr_text == "应"


def test_keeps_numeral_matching_subtitle_digit():
    cue = make_cue(0, 0, "4个系统异常", 1100)
    timeline = [("四", 190, 310), ("个", 310, 410), ("系", 410, 550), ("统", 550, 630), ("异", 630, 870), ("常", 870, 1590)]
    segment = AsrSegment(
        id="seg-0",
        start_ms=190,
        end_ms=1590,
        text="四个系统异常",
        avg_logprob=-0.1,
        no_speech_prob=0.05,
        words=[
            AsrWord(
                id=f"w-{index}",
                text=text,
                start_ms=start,
                end_ms=end,
                probability=0.99,
                segment_id="seg-0",
            )
            for index, (text, start, end) in enumerate(timeline)
        ],
    )
    bundle = align([cue], [segment], DEFAULT_OPTIONS)
    alignment = bundle.alignments[0]
    assert alignment.asr_text == "四个系统异常"
    assert alignment.edits == []


def test_narrow_window_truncation_is_recovered():
    cue = make_cue(0, 9500, "首先打开点火开关", 1750)
    timeline = [
        ("首先", 10860, 11560),
        ("打", 11560, 11880),
        ("开", 11880, 12000),
        ("点", 12000, 12200),
        ("火", 12200, 12340),
        ("开", 12340, 12560),
        ("关", 12560, 13340),
    ]
    segment = AsrSegment(
        id="seg-0",
        start_ms=10860,
        end_ms=13340,
        text="首先打开点火开关",
        avg_logprob=-0.07,
        no_speech_prob=0.61,
        words=[
            AsrWord(
                id=f"w-0-{index}",
                text=text,
                start_ms=start,
                end_ms=end,
                probability=0.99,
                segment_id="seg-0",
            )
            for index, (text, start, end) in enumerate(timeline)
        ],
    )
    bundle = align([cue], [segment], DEFAULT_OPTIONS)
    alignment = bundle.alignments[0]
    assert alignment.asr_text == "首先打开点火开关"
    assert alignment.edits == []
