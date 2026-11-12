from __future__ import annotations

from typing import Optional

from rapidfuzz import fuzz

from .align import AlignmentBundle, CueAlignment, normalize, simplify
from .pinyin import primary_reading, similarity
from .schema import AsrSegment, AsrWord, Cue, Evidence, Finding, PinyinEvidence, Summary


def _is_cjk(char: str) -> bool:
    return "一" <= char <= "鿿"


def _has_cjk(text: str) -> bool:
    return any(_is_cjk(char) for char in text)


def _cjk_len(text: str) -> int:
    return sum(1 for char in text if _is_cjk(char))


def _word_map(alignment: CueAlignment) -> dict[str, AsrWord]:
    return {word.id: word for word in alignment.words}


def _confidence(alignment: CueAlignment, start: int, end: int) -> Optional[float]:
    ids = {
        word_id
        for word_id in alignment.asr_word_ids[start:end]
        if word_id is not None
    }
    if not ids:
        ids = {word.id for word in alignment.words}
    probabilities = [word.probability for word in alignment.words if word.id in ids]
    return min(probabilities) if probabilities else None


def _additive_asr_noise(alignment: CueAlignment) -> bool:
    """True when ASR only added a few syllables on top of the subtitle reading.

    Insertions are ASR hallucinations or extra speech; they do not contradict the
    subtitle, so they must not be reported as a subtitle error.
    """
    sub = [primary_reading(char) for char in alignment.sub_norm if _is_cjk(char)]
    asr = [primary_reading(char) for char in alignment.asr_norm if _is_cjk(char)]
    if len(sub) < 2 or not len(sub) < len(asr) <= len(sub) + 3:
        return False
    position = 0
    for syllable in asr:
        if position < len(sub) and syllable == sub[position]:
            position += 1
    return position == len(sub)


def _edge_only(alignment: CueAlignment, spans: list[tuple[str, int, int, int, int]]) -> bool:
    """True when every remaining difference sits at the start or end of the alignment."""
    sub_len = len(alignment.sub_norm)
    asr_len = len(alignment.asr_norm)
    for tag, i1, i2, j1, j2 in spans:
        if tag == "delete" and not (i1 == 0 or i2 >= sub_len):
            return False
        if tag == "insert" and not (j1 == 0 or j2 >= asr_len):
            return False
    return True


def _spoken_before(segments: list[AsrSegment], first_word_id: Optional[str], limit: int = 6) -> str:
    """Text of the words right before the aligned run (used to explain truncation)."""
    if not first_word_id:
        return ""
    flat = [word for segment in segments for word in segment.words]
    index = next((i for i, word in enumerate(flat) if word.id == first_word_id), None)
    if index is None:
        return ""
    return "".join(word.text for word in flat[max(0, index - limit) : index])


def _segment_stats(
    alignment: CueAlignment,
    segments: dict[str, AsrSegment],
    start: int,
    end: int,
) -> tuple[float, float]:
    ids = {word_id for word_id in alignment.asr_word_ids[start:end] if word_id is not None}
    words = [word for word in alignment.words if word.id in ids]
    if not words:
        words = alignment.words
    selected = [segments[word.segment_id] for word in words if word.segment_id in segments]
    if not selected:
        return 0.0, 0.0
    return min(segment.avg_logprob for segment in selected), max(segment.no_speech_prob for segment in selected)


def _words_evidence(alignment: CueAlignment, start: int, end: int) -> list[dict]:
    ids = {word_id for word_id in alignment.asr_word_ids[start:end] if word_id is not None}
    if not ids:
        ids = {word.id for word in alignment.words}
    return [
        {"id": word.id, "text": word.text, "probability": round(word.probability, 4)}
        for word in alignment.words
        if word.id in ids
    ]


def _base_evidence(alignment: CueAlignment, start: int, end: int) -> Evidence:
    return Evidence(
        edits=[],
        words=_words_evidence(alignment, start, end),
        timing=None,
    )


def _confidence_label(value: Optional[float]) -> str:
    return "未知" if value is None else f"{value:.2f}"


def build_findings(
    cues: list[Cue],
    segments: list[AsrSegment],
    bundle: AlignmentBundle,
    options: dict,
) -> list[Finding]:
    segment_map = {segment.id: segment for segment in segments}
    threshold = float(options.get("confidenceThreshold", 0.9))
    uncertain_threshold = float(options.get("uncertainThreshold", 0.65))
    pinyin_threshold = float(options.get("pinyinThreshold", 0.8))
    alignment_threshold = float(options.get("alignmentThreshold", 0.85)) * 100
    timing_tolerance = float(options.get("timingToleranceMs", 500))
    findings: list[Finding] = []
    counter = 0
    cue_index = {cue.id: index for index, cue in enumerate(cues)}

    for alignment in bundle.alignments:
        content_edits = []
        content_spans = []
        typo_found = False
        non_equal = [opcode for opcode in alignment.opcodes if opcode[0] != "equal"]
        if non_equal and _additive_asr_noise(alignment):
            counter += 1
            evidence = _base_evidence(alignment, 0, len(alignment.asr_word_ids))
            evidence.edits = alignment.edits
            evidence.note = "语音识别多出字幕以外的内容"
            findings.append(
                Finding(
                    id=f"uncertain-{alignment.cue_ids[0]}-{counter}",
                    kind="uncertain",
                    severity="info",
                    cue_ids=alignment.cue_ids,
                    start_ms=alignment.start_ms,
                    end_ms=alignment.end_ms,
                    title="语音多识别",
                    message="语音识别结果比字幕多出少量字词，可能是识别插入；字幕内容未被否定，仅供参考。",
                    subtitle_text=alignment.sub_text,
                    asr_text=alignment.asr_text,
                    evidence=evidence,
                )
            )
            continue
        edit_chars = sum(max(i2 - i1, j2 - j1) for _, i1, i2, j1, j2 in non_equal)
        alignment_ok = alignment.ratio >= alignment_threshold or (
            alignment.ratio >= 60 and edit_chars <= 2
        )
        lagging_start = (
            alignment.first_word_start_ms is not None
            and alignment.start_ms - alignment.first_word_start_ms > timing_tolerance
        )
        lagging_end = (
            alignment.last_word_end_ms is not None
            and alignment.end_ms - alignment.last_word_end_ms > timing_tolerance
        )
        spoken_before = _spoken_before(
            segments, alignment.words[0].id if alignment.words else None
        )
        first_cue = cue_index.get(alignment.cue_ids[0])
        last_cue = cue_index.get(alignment.cue_ids[-1])
        previous_cue = cues[first_cue - 1] if first_cue else None
        next_cue = cues[last_cue + 1] if last_cue is not None and last_cue + 1 < len(cues) else None
        for edit, (tag, i1, i2, j1, j2) in zip(alignment.edits, non_equal):
            if tag == "delete" and (
                (i1 == 0 and lagging_start) or (i2 >= len(alignment.sub_norm) and lagging_end)
            ):
                continue
            if tag == "delete" and i1 == 0 and spoken_before:
                prefix, _ = normalize(edit.sub_text)
                spoken, _ = normalize(spoken_before)
                if prefix and spoken and fuzz.partial_ratio(prefix, spoken) >= 80:
                    continue
            # Words straddling a cue boundary are assigned to one side by the ASR; ignore
            # inserts that merely repeat what the neighbouring cue already contains.
            if tag == "insert" and j2 >= len(alignment.asr_norm) and next_cue is not None:
                tail, _ = normalize(edit.asr_text)
                upcoming, _ = normalize(next_cue.text)
                if tail and upcoming.startswith(tail):
                    continue
            if tag == "insert" and j1 == 0 and previous_cue is not None:
                head, _ = normalize(edit.asr_text)
                before, _ = normalize(previous_cue.text)
                if head and before.endswith(head):
                    continue
            confidence = _confidence(alignment, j1, j2)
            avg_logprob, no_speech = _segment_stats(alignment, segment_map, j1, j2)

            if tag == "replace" and _has_cjk(edit.sub_text) and _has_cjk(edit.asr_text):
                if abs(_cjk_len(edit.sub_text) - _cjk_len(edit.asr_text)) <= 1:
                    score, relation, sub_reading, asr_reading = similarity(
                        simplify(edit.sub_text), simplify(edit.asr_text)
                    )
                    pinyin_ok = score >= pinyin_threshold
                    confidence_ok = confidence is not None and confidence >= threshold
                    segment_ok = avg_logprob >= -1.0 and no_speech <= 0.50
                    if pinyin_ok and alignment_ok and confidence_ok and segment_ok:
                        counter += 1
                        severity = (
                            "high"
                            if relation == "homophone" and (confidence or 0) >= 0.97
                            else "review"
                        )
                        evidence = _base_evidence(alignment, j1, j2)
                        evidence.edits = [edit]
                        evidence.pinyin = PinyinEvidence(
                            sub=sub_reading,
                            asr=asr_reading,
                            similarity=round(score, 3),
                            relation=relation,
                        )
                        typo_found = True
                        findings.append(
                            Finding(
                                id=f"typo-{alignment.cue_ids[0]}-{counter}",
                                kind="typo",
                                severity=severity,
                                cue_ids=alignment.cue_ids,
                                start_ms=alignment.start_ms,
                                end_ms=alignment.end_ms,
                                title="疑似错别字",
                                message=(
                                    f"字幕「{edit.sub_text}」与语音识别「{edit.asr_text}」"
                                    f"为{'同音' if relation == 'homophone' else '近音'}"
                                    f"关系，词级置信度 {_confidence_label(confidence)}。请人工确认。"
                                ),
                                subtitle_text=alignment.sub_text,
                                asr_text=alignment.asr_text,
                                confidence=confidence,
                                suggestion=(
                                    simplify(edit.asr_text)
                                    if options.get("t2s", True)
                                    else edit.asr_text
                                ),
                                evidence=evidence,
                            )
                        )
                        continue
                    if pinyin_ok and (confidence is None or confidence < threshold):
                        counter += 1
                        evidence = _base_evidence(alignment, j1, j2)
                        evidence.edits = [edit]
                        evidence.pinyin = PinyinEvidence(
                            sub=sub_reading,
                            asr=asr_reading,
                            similarity=round(score, 3),
                            relation=relation,
                        )
                        evidence.note = "ASR 词级置信度不足，未判定为错别字"
                        findings.append(
                            Finding(
                                id=f"uncertain-{alignment.cue_ids[0]}-{counter}",
                                kind="uncertain",
                                severity="info",
                                cue_ids=alignment.cue_ids,
                                start_ms=alignment.start_ms,
                                end_ms=alignment.end_ms,
                                title="ASR 置信度不足",
                                message=(
                                    f"字幕「{edit.sub_text}」与识别「{edit.asr_text}」疑似同音，"
                                    f"但词级置信度仅 {_confidence_label(confidence)}，需人工确认。"
                                ),
                                subtitle_text=alignment.sub_text,
                                asr_text=alignment.asr_text,
                                confidence=confidence,
                                evidence=evidence,
                            )
                        )
                        continue
            content_edits.append(edit)
            content_spans.append((tag, i1, i2, j1, j2))

        if content_edits:
            total_chars = sum(
                max(len(edit.sub_text), len(edit.asr_text)) for edit in content_edits
            )
            if typo_found and total_chars <= 2:
                content_edits = []

        if (
            content_edits
            and not any(edit.op == "replace" for edit in content_edits)
            and _edge_only(alignment, content_spans)
            and total_chars <= 3
        ):
            counter += 1
            evidence = _base_evidence(alignment, 0, len(alignment.asr_word_ids))
            evidence.edits = content_edits
            evidence.note = "语音边界差异"
            findings.append(
                Finding(
                    id=f"uncertain-{alignment.cue_ids[0]}-{counter}",
                    kind="uncertain",
                    severity="info",
                    cue_ids=alignment.cue_ids,
                    start_ms=alignment.start_ms,
                    end_ms=alignment.end_ms,
                    title="语音边界差异",
                    message="语音识别在边界处多出或漏掉少量字词，可能是分段截断；字幕内容未被否定，仅供参考。",
                    subtitle_text=alignment.sub_text,
                    asr_text=alignment.asr_text,
                    confidence=_confidence(alignment, 0, len(alignment.asr_word_ids)),
                    evidence=evidence,
                )
            )
            content_edits = []

        if content_edits:
            counter += 1
            severity = "high" if total_chars >= 8 or not alignment_ok else "review"
            evidence = _base_evidence(alignment, 0, len(alignment.asr_word_ids))
            evidence.edits = content_edits
            findings.append(
                Finding(
                    id=f"content-{alignment.cue_ids[0]}-{counter}",
                    kind="content",
                    severity=severity if alignment_ok else "info",
                    cue_ids=alignment.cue_ids,
                    start_ms=alignment.start_ms,
                    end_ms=alignment.end_ms,
                    title="字幕与语音不一致",
                    message="字幕文本与识别文本存在无法用同音字解释的差异，请核对。",
                    subtitle_text=alignment.sub_text,
                    asr_text=alignment.asr_text,
                    confidence=_confidence(alignment, 0, len(alignment.asr_word_ids)),
                    evidence=evidence,
                )
            )
        elif not alignment.words and alignment.sub_norm:
            counter += 1
            findings.append(
                Finding(
                    id=f"uncertain-{alignment.cue_ids[0]}-{counter}",
                    kind="uncertain",
                    severity="info",
                    cue_ids=alignment.cue_ids,
                    start_ms=alignment.start_ms,
                    end_ms=alignment.end_ms,
                    title="未检测到对应语音",
                    message="该字幕时间段内没有可对齐的语音，可能是音乐、画面文字或时间轴错位。",
                    subtitle_text=alignment.sub_text,
                    asr_text="",
                    evidence=Evidence(edits=[], words=[], note="无对齐词"),
                )
            )

    for segment in segments:
        if segment.avg_logprob >= -1.0 and segment.no_speech_prob <= 0.6:
            continue
        overlapping = [
            cue for cue in cues if cue.start_ms < segment.end_ms and cue.end_ms > segment.start_ms
        ]
        if not overlapping:
            continue
        counter += 1
        findings.append(
            Finding(
                id=f"uncertain-{segment.id}-{counter}",
                kind="uncertain",
                severity="info",
                cue_ids=[cue.id for cue in overlapping],
                start_ms=segment.start_ms,
                end_ms=segment.end_ms,
                title="ASR 置信度较低",
                message=(
                    f"该语音段平均对数概率 {segment.avg_logprob:.2f}，"
                    f"无语音概率 {segment.no_speech_prob:.2f}，结论仅供参考。"
                ),
                subtitle_text=" ".join(cue.text for cue in overlapping),
                asr_text=segment.text,
                confidence=round(
                    sum(word.probability for word in segment.words) / max(1, len(segment.words)), 4
                ),
                evidence=Evidence(edits=[], words=[], note="低置信度语音段"),
            )
        )

    return findings


def build_summary(
    cues: list[Cue],
    segments: list[AsrSegment],
    bundle: AlignmentBundle,
    findings: list[Finding],
    duration_ms: int,
) -> Summary:
    total_chars = 0
    edit_chars = 0
    matched = 0
    for alignment in bundle.alignments:
        total_chars += len(alignment.sub_norm)
        if alignment.ratio >= 50:
            matched += 1
        for tag, i1, i2, j1, j2 in alignment.opcodes:
            if tag != "equal":
                edit_chars += max(i2 - i1, j2 - j1)
    consistency = 0.0 if total_chars == 0 else max(0.0, min(1.0, 1 - edit_chars / total_chars))
    probabilities = [
        word.probability for segment in segments for word in segment.words if word.probability is not None
    ]
    avg_confidence = sum(probabilities) / len(probabilities) if probabilities else 0.0
    counts = {"typo": 0, "content": 0, "timing": 0, "uncertain": 0}
    for finding in findings:
        counts[finding.kind] = counts.get(finding.kind, 0) + 1
    return Summary(
        duration_ms=duration_ms,
        cue_count=len(cues),
        matched_cue_count=matched,
        consistency=round(consistency, 4),
        avg_confidence=round(avg_confidence, 4),
        counts=counts,
        global_offset_ms=bundle.global_offset_ms,
        drift_ms_per_minute=(
            round(bundle.drift_ms_per_minute, 2)
            if bundle.drift_ms_per_minute is not None
            else None
        ),
    )
