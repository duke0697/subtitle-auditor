from app.pinyin import similarity


def test_homophone():
    score, relation, _, _ = similarity("在", "再")
    assert score == 1.0
    assert relation == "homophone"


def test_tone_difference():
    score, relation, _, _ = similarity("妈", "马")
    assert 0.85 <= score < 1.0
    assert relation == "tone"


def test_initial_confusion():
    score, relation, _, _ = similarity("三", "山")
    assert score == 0.8
    assert relation == "confusion"


def test_unrelated():
    score, _, _, _ = similarity("天", "水")
    assert score == 0.0


def test_sentence_level():
    score, relation, _, _ = similarity("我在家里", "我再家里")
    assert score == 1.0
    assert relation == "homophone"


def test_relation_uses_the_weakest_pair_regardless_of_order():
    assert similarity("在三", "再山")[1] == "confusion"
    assert similarity("三在", "山再")[1] == "confusion"
