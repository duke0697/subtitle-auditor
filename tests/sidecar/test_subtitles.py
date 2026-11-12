from pathlib import Path

import pysubs2

from app.subtitles import detect_encoding, load

SIMPLE_SRT = """1
00:00:01,000 --> 00:00:02,500
你好，世界

2
00:00:03,000 --> 00:00:04,000
第二句字幕
"""

ASS = """[Script Info]
Title: test
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,你好，世界
Dialogue: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,第二句字幕
"""


def test_srt_utf8(tmp_path: Path):
    path = tmp_path / "sample.srt"
    path.write_text(SIMPLE_SRT, encoding="utf-8")
    cues, encoding, fmt = load(str(path))
    assert encoding.lower().startswith("utf-8")
    assert fmt == "srt"
    assert len(cues) == 2
    assert cues[0].text == "你好，世界"
    assert cues[0].start_ms == 1000


def test_srt_gbk(tmp_path: Path):
    path = tmp_path / "gbk.srt"
    path.write_bytes(SIMPLE_SRT.encode("gb18030"))
    assert detect_encoding(str(path)) in {"gb18030", "gbk", "gb2312"}
    cues, encoding, _ = load(str(path))
    assert len(cues) == 2
    assert cues[1].text == "第二句字幕"


def test_ass(tmp_path: Path):
    path = tmp_path / "sample.ass"
    path.write_text(ASS, encoding="utf-8")
    cues, _, fmt = load(str(path))
    assert fmt == "ass"
    assert len(cues) == 2
    assert cues[0].text == "你好，世界"


def test_pysubs2_can_load(tmp_path: Path):
    path = tmp_path / "sample.ass"
    path.write_text(ASS, encoding="utf-8")
    subs = pysubs2.load(str(path))
    assert len(subs) == 2
