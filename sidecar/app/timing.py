from __future__ import annotations

from .align import AlignmentBundle
from .schema import AsrSegment, Cue, Evidence, Finding, TimingEvidence
from .subtitles import find_overlaps


def _time(ms: int) -> str:
    total = max(0, int(ms))
    minutes = total // 60_000
    seconds = (total % 60_000) / 1000
    return f"{minutes:02d}:{seconds:05.2f}"


def build_timing_findings(
    cues: list[Cue],
    segments: list[AsrSegment],
    bundle: AlignmentBundle,
    options: dict,
) -> list[Finding]:
    findings: list[Finding] = []
    offset = bundle.global_offset_ms or 0
    threshold = float(options.get("globalOffsetMs", 500))
    tolerance = float(options.get("timingToleranceMs", 500))
    if options.get("ocrSource"):
        # OCR cue times come from when the text appears on screen, which naturally leads
        # the speech; the display lead is not a timeline defect worth reviewing.
        tolerance = max(tolerance, 1500.0)
        threshold = max(threshold, 1500.0)

    if bundle.global_offset_ms is not None and abs(bundle.global_offset_ms) >= threshold:
        direction = "晚于" if bundle.global_offset_ms > 0 else "早于"
        spread = (
            f"，各条波动 ±{bundle.offset_mad_ms} ms，并非统一平移"
            if bundle.offset_mad_ms is not None and bundle.offset_mad_ms > 250
            else ""
        )
        findings.append(
            Finding(
                id="timing-global-offset",
                kind="timing",
                severity="high" if abs(bundle.global_offset_ms) >= 2000 else "review",
                cue_ids=[],
                start_ms=0,
                end_ms=0,
                title="字幕整体时间偏移",
                message=(
                    f"全局估计字幕{direction}语音约 {abs(bundle.global_offset_ms)} ms"
                    f"（{bundle.anchors} 个锚点{spread}）。"
                    "建议先整体校正时间轴，再逐条核对。"
                ),
                subtitle_text="",
                asr_text="",
                evidence=Evidence(
                    edits=[],
                    words=[],
                    timing=TimingEvidence(
                        start_drift_ms=0,
                        end_drift_ms=0,
                        global_offset_ms=bundle.global_offset_ms,
                    ),
                ),
            )
        )

    if (
        bundle.drift_ms_per_minute is not None
        and bundle.drift_total_ms is not None
        and abs(bundle.drift_ms_per_minute) > 100
        and abs(bundle.drift_total_ms) > max(500.0, threshold)
    ):
        findings.append(
            Finding(
                id="timing-progressive-drift",
                kind="timing",
                severity="review",
                cue_ids=[],
                start_ms=0,
                end_ms=0,
                title="字幕渐进漂移",
                message=(
                    f"字幕偏移随片长累积，约 {bundle.drift_ms_per_minute:.0f} ms/分钟，"
                    f"全片累计 {bundle.drift_total_ms:.0f} ms。常见于帧率不匹配。"
                ),
                subtitle_text="",
                asr_text="",
                evidence=Evidence(edits=[], words=[], note="渐进漂移"),
            )
        )

    for alignment in bundle.alignments:
        if (
            alignment.ratio < 60
            or alignment.first_word_start_ms is None
            or alignment.last_word_end_ms is None
        ):
            continue
        start_drift = alignment.start_ms - alignment.first_word_start_ms - offset
        end_drift = alignment.end_ms - alignment.last_word_end_ms - offset
        # A cue whose text is cut at the edge only looks shifted; the ASR run simply
        # starts/ends mid-sentence there.
        lead_cut = any(
            (tag == "delete" and i1 == 0) or (tag == "insert" and j1 == 0)
            for tag, i1, _, j1, _ in alignment.opcodes
        )
        tail_cut = any(
            (tag == "delete" and i2 >= len(alignment.sub_norm))
            or (tag == "insert" and j2 >= len(alignment.asr_norm))
            for tag, _, i2, _, j2 in alignment.opcodes
        )
        if lead_cut:
            start_drift = 0
        if tail_cut:
            end_drift = 0
        if abs(start_drift) <= tolerance and abs(end_drift) <= tolerance:
            continue
        severity = (
            "high"
            if abs(start_drift) > 1500 or end_drift < -1500 or end_drift > 2500
            else "review"
        )
        direction = "晚于" if start_drift > 0 else "早于"
        findings.append(
            Finding(
                id=f"timing-{alignment.cue_ids[0]}",
                kind="timing",
                severity=severity,
                cue_ids=alignment.cue_ids,
                start_ms=alignment.start_ms,
                end_ms=alignment.end_ms,
                title="时间轴偏差",
                message=(
                    f"字幕起点{direction}语音 {abs(start_drift)} ms，"
                    f"终点偏差 {end_drift:+.0f} ms。"
                ),
                subtitle_text=alignment.sub_text,
                asr_text=alignment.asr_text,
                evidence=Evidence(
                    edits=[],
                    words=[],
                    timing=TimingEvidence(
                        start_drift_ms=int(start_drift),
                        end_drift_ms=int(end_drift),
                        global_offset_ms=bundle.global_offset_ms,
                    ),
                ),
            )
        )

    for index, (previous, current, overlap) in enumerate(find_overlaps(cues, 100)):
        if index >= 30:
            break
        findings.append(
            Finding(
                id=f"timing-overlap-{index}",
                kind="timing",
                severity="review" if overlap >= 500 else "info",
                cue_ids=[previous.id, current.id],
                start_ms=current.start_ms,
                end_ms=min(previous.end_ms, current.end_ms),
                title="字幕时间重叠",
                message=f"相邻字幕重叠 {overlap} ms，可能导致同时显示。",
                subtitle_text=f"{previous.text} / {current.text}",
                asr_text="",
                evidence=Evidence(edits=[], words=[], note="时间重叠"),
            )
        )

    voice_findings = 0
    for index, segment in enumerate(segments):
        if voice_findings >= 50:
            break
        if segment.end_ms - segment.start_ms < 1500:
            continue
        best_overlap = 0
        for cue in cues:
            overlap = min(cue.end_ms, segment.end_ms) - max(cue.start_ms, segment.start_ms)
            if overlap > best_overlap:
                best_overlap = overlap
        if best_overlap >= 200:
            continue
        findings.append(
            Finding(
                id=f"timing-voice-{index}",
                kind="timing",
                severity="info",
                cue_ids=[],
                start_ms=segment.start_ms,
                end_ms=segment.end_ms,
                title="语音段无字幕",
                message=(
                    f"{_time(segment.start_ms)} 附近检测到 "
                    f"{(segment.end_ms - segment.start_ms) / 1000:.1f}s 语音，但没有对应字幕。"
                ),
                subtitle_text="",
                asr_text=segment.text,
                evidence=Evidence(edits=[], words=[], note="语音无字幕"),
            )
        )
        voice_findings += 1

    return findings
