from app.glossary import build_index, normalize_segment, normalize_text
from app.schema import AsrSegment, AsrWord


def segment_with(text: str, words: list[str]) -> AsrSegment:
    return AsrSegment(
        id="seg-0",
        start_ms=0,
        end_ms=1000,
        text=text,
        avg_logprob=0.0,
        no_speech_prob=0.0,
        words=[
            AsrWord(
                id=f"w-{index}",
                text=word,
                start_ms=index,
                end_ms=index + 1,
                probability=0.9,
                segment_id="seg-0",
            )
            for index, word in enumerate(words)
        ],
    )


def test_replaces_homophone_across_words():
    segment = segment_with("本次用到的实讯设备", ["本次", "用到的", "实", "讯", "设备"])
    normalize_segment(segment, build_index(["实训"]))
    assert segment.text == "本次用到的实训设备"
    assert [word.text for word in segment.words] == ["本次", "用到的", "实", "训", "设备"]


def test_replaces_homophone_inside_word():
    segment = segment_with("检查时讯环境", ["检查", "时讯", "环境"])
    normalize_segment(segment, build_index(["实训"]))
    assert segment.text == "检查实训环境"
    assert segment.words[1].text == "实训"


def test_prefers_longer_term():
    segment = segment_with("实讯小车诊断", ["实讯小车", "诊断"])
    normalize_segment(segment, build_index(["实训", "实训小车"]))
    assert segment.text == "实训小车诊断"


def test_keeps_correct_term():
    segment = segment_with("本实训主要分为实训准备", ["本", "实训", "主要", "分为", "实训", "准备"])
    normalize_segment(segment, build_index(["实训"]))
    assert segment.text == "本实训主要分为实训准备"
    assert "".join(word.text for word in segment.words) == "本实训主要分为实训准备"


def test_matches_ascii_case_insensitively():
    segment = segment_with("读取bms故障码", ["读取", "bms", "故障码"])
    normalize_segment(segment, build_index(["BMS"]))
    assert segment.text == "读取BMS故障码"
    assert segment.words[1].text == "BMS"


def test_ignores_ascii_inside_longer_word():
    assert normalize_text("abmsx", build_index(["BMS"])) == "abmsx"


def test_leaves_unrelated_text_alone():
    assert normalize_text("本次用到的设备", build_index(["实训"])) == "本次用到的设备"


def test_normalizes_diangong():
    assert normalize_text("检查电弓绝缘手套", build_index(["电工", "绝缘手套"])) == "检查电工绝缘手套"


def test_normalizes_zhongduan_dianzu():
    assert normalize_text("120欧中端电阻", build_index(["终端电阻"])) == "120欧终端电阻"
