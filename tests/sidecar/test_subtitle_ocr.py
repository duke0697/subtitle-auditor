from app.subtitle_ocr import merge_samples


def test_repeated_text_extends_cue():
    cues = merge_samples([(0.0, "你好", 0.9), (0.5, "你好", 0.95), (1.0, "", 0.0)])
    assert len(cues) == 1
    assert cues[0].start_s == 0.0
    assert cues[0].end_s == 1.0
    assert cues[0].score == 0.95


def test_text_change_splits_cue_at_change_time():
    cues = merge_samples([(0.0, "第一句", 0.9), (1.0, "第二句", 0.9), (2.0, "", 0.0)])
    assert [cue.text for cue in cues] == ["第一句", "第二句"]
    assert cues[0].start_s == 0.0
    assert cues[0].end_s == 1.0
    assert cues[1].start_s == 1.0
    assert cues[1].end_s == 2.0


def test_empty_samples_produce_no_cues():
    assert merge_samples([(0.0, "", 0.0), (1.0, "", 0.0)]) == []


def test_single_sample_cue_is_kept():
    cues = merge_samples([(5.0, "末尾", 0.8)])
    assert len(cues) == 1
    assert cues[0].start_s == 5.0
    assert cues[0].end_s == 5.0


def test_blank_gap_between_same_text_splits():
    cues = merge_samples([(0.0, "同一句", 0.9), (1.0, "", 0.0), (2.0, "同一句", 0.9)])
    assert len(cues) == 2
    assert cues[0].end_s == 1.0
    assert cues[1].start_s == 2.0
