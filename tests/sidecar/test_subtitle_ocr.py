from app.subtitle_ocr import _select_lines, merge_samples


def box(text, left, right, top, bottom, score=0.9):
    return {"text": text, "score": score, "left": left, "right": right, "top": top, "bottom": bottom}


def test_ui_boxes_touching_band_edges_are_dropped():
    assert _select_lines([box("VY", 416, 640, 0, 48)], 640, 48) == []


def test_right_side_label_is_dropped():
    boxes = [box("概压", 627, 640, 15, 27, 0.63), box("选择重置", 275, 365, 6, 34)]
    assert _select_lines(boxes, 640, 48) == [("选择重置", 0.9)]


def test_left_camera_label_is_dropped():
    boxes = [box("转向伺服电机", 6, 141, 16, 39), box("将第2组CAN通讯线束一端的蓝色线", 192, 448, 17, 37)]
    assert [text for text, _ in _select_lines(boxes, 640, 48)] == ["将第2组CAN通讯线束一端的蓝色线"]


def test_overlapping_detector_boxes_merge_without_duplicating():
    # RapidOCR split one subtitle line into two overlapping boxes at 3:11.
    boxes = [box("一端的蓝色线", 352, 448, 16, 36), box("将这组CAN通讯线束另一", 192, 365, 17, 37)]
    assert [text for text, _ in _select_lines(boxes, 640, 48)] == ["将这组CAN通讯线束另一端的蓝色线"]


def test_stacked_two_line_subtitle_keeps_both_lines_in_reading_order():
    boxes = [box("上行字幕", 190, 450, 1, 19), box("下行字幕", 190, 450, 21, 39)]
    assert [text for text, _ in _select_lines(boxes, 640, 48)] == ["上行字幕", "下行字幕"]


def test_small_module_label_above_subtitle_is_not_merged():
    boxes = [
        box("动力电池管理模块", 154, 253, 2, 17),
        box("将第3组CAN通讯线束一端的蓝色线", 190, 449, 14, 38),
    ]
    assert [text for text, _ in _select_lines(boxes, 640, 48)] == ["将第3组CAN通讯线束一端的蓝色线"]


def test_change_is_ignored_until_the_next_sample_confirms_it():
    samples = [(0.0, "第一行\n第二行", 0.9), (0.5, "第一行", 0.8), (1.0, "第一行\n第二行", 0.9), (2.0, "", 0.0)]
    cues = merge_samples(samples)
    assert len(cues) == 1
    assert cues[0].text == "第一行\n第二行"
    assert cues[0].end_s == 2.0


def test_confirmed_change_still_splits():
    samples = [(0.0, "第一句", 0.9), (0.5, "第二句", 0.9), (1.0, "第二句", 0.9), (2.0, "", 0.0)]
    cues = merge_samples(samples)
    assert [cue.text for cue in cues] == ["第一句", "第二句"]
    assert cues[0].end_s == 0.5
    assert cues[1].start_s == 0.5


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
