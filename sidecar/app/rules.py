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
    subtitle, so they must not be reported as a subtitle error. The syllable
    subsequence test also catches them when the aligner encodes them as a replace.
    """
    sub = [primary_reading(char) for char in alignment.sub_norm]
    asr = [primary_reading(char) for char in alignment.asr_norm]
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


def _cue_boundary_only(alignment: CueAlignment, spans: list[tuple[str, int, int, int, int]]) -> bool:
    """True when every difference is a delete at a wrap between two cues."""
    boundaries = {
        offset for offset in alignment.cue_offsets[1:] if 0 < offset < len(alignment.sub_norm)
    }
    if not boundaries:
        return False
    for tag, i1, i2, _, _ in spans:
        if tag != "delete" or not (i1 in boundaries or i2 in boundaries):
            return False
    return True


def _ascii_token(text: str, start: int, end: int) -> str:
    """Extend a raw edit to its alphanumeric token (CAN-L, not just the mapped C)."""
    options = "-_."
    left, right = start, end
    while left > 0 and text[left - 1].isascii() and (text[left - 1].isalnum() or text[left - 1] in options):
        left -= 1
    while right < len(text) and text[right].isascii() and (text[right].isalnum() or text[right] in options):
        right += 1
    return text[left:right]


def _clusters(spans: list[tuple[str, int, int, int, int]]) -> list[list[tuple[str, int, int, int, int]]]:
    """Group diff spans that sit close together; a garbled acronym splits into several spans."""
    clusters: list[list[tuple[str, int, int, int, int]]] = []
    for span in spans:
        if (
            clusters
            and span[1] - clusters[-1][-1][2] <= 2
            and span[3] - clusters[-1][-1][4] <= 2
        ):
            clusters[-1].append(span)
        else:
            clusters.append([span])
    return clusters


def _raw_key(text: str) -> str:
    return "".join(char.lower() for char in text if char.isalnum() or "一" <= char <= "鿿")


def _boundary_repeat(edit_text: str, cue_text: str, suffix: bool) -> bool:
    """Catch boundary repeats that normalization splits (CAN-L 端子 vs L 端子)."""
    edit, cue = _raw_key(edit_text), _raw_key(cue_text)
    if not edit or not cue:
        return False
    return cue.endswith(edit) if suffix else cue.startswith(edit)


def _phrase_pairs(
    alignment: CueAlignment, i1: int, i2: int, j1: int, j2: int, corpus: str
) -> list[tuple[int, int, str, str]]:
    """Count the differing phrase plus one neighbour on both sides of the corpus.

    Single-character counts are too coarse: 「插」 also occurs in 「插头」, which used to
    corroborate an ASR misread of 「差分」. The phrase keeps the comparison specific.
    """
    sub, asr = alignment.sub_norm, alignment.asr_norm
    pairs: list[tuple[int, int, str, str]] = []
    for suffix in (False, True):
        sub_phrase = sub[i1 : min(len(sub), i2 + 1)] if not suffix else sub[max(0, i1 - 1) : i2]
        asr_phrase = asr[j1 : min(len(asr), j2 + 1)] if not suffix else asr[max(0, j1 - 1) : j2]
        if not sub_phrase or not asr_phrase:
            continue
        pairs.append((corpus.count(sub_phrase), corpus.count(asr_phrase), sub_phrase, asr_phrase))
    return pairs


def _spoken_before(segments: list[AsrSegment], first_word_id: Optional[str], limit: int = 6) -> str:
    """Text of the words right before the aligned run (used to explain truncation)."""
    if not first_word_id:
        return ""
    flat = [word for segment in segments for word in segment.words]
    index = next((i for i, word in enumerate(flat) if word.id == first_word_id), None)
    if index is None:
        return ""
    return "".join(word.text for word in flat[max(0, index - limit) : index])


def _segment_logprob(
    alignment: CueAlignment,
    segments: dict[str, AsrSegment],
    start: int,
    end: int,
) -> float:
    ids = {word_id for word_id in alignment.asr_word_ids[start:end] if word_id is not None}
    words = [word for word in alignment.words if word.id in ids]
    if not words:
        words = alignment.words
    selected = [segments[word.segment_id] for word in words if word.segment_id in segments]
    if not selected:
        return 0.0
    return min(segment.avg_logprob for segment in selected)


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


def _glossary_supports(alignment: CueAlignment, i1: int, i2: int, j1: int, j2: int, terms: list[str]) -> bool:
    """True when the speech matches a glossary term the subtitle spells differently.

    Only a full term (length >= 3) overlapping the edit counts: shorter generic words
    such as 急停 would otherwise corroborate unrelated homophones.
    """
    asr, sub = alignment.asr_norm, alignment.sub_norm
    for term in terms:
        start = asr.find(term)
        while start != -1:
            end = start + len(term)
            if start <= j1 and j2 <= end:
                offset = j1 - start
                sub_span = sub[i1 - offset : i1 - offset + len(term)]
                tail = offset + (j2 - j1)
                if (
                    len(sub_span) == len(term)
                    and sub_span != term
                    and sub_span[:offset] == term[:offset]
                    and sub_span[tail:] == term[tail:]
                ):
                    return True
            start = asr.find(term, start + 1)
    return False


def _merge_repeats(findings: list[Finding]) -> list[Finding]:
    """Fold identical edits inside one aligned group into a single finding."""
    merged: dict[tuple, Finding] = {}
    output: list[Finding] = []
    for finding in findings:
        edits = finding.evidence.edits
        if not edits:
            output.append(finding)
            continue
        key = (
            finding.kind,
            finding.title,
            tuple(finding.cue_ids),
            tuple((edit.sub_text, edit.asr_text) for edit in edits),
        )
        existing = merged.get(key)
        if existing is None:
            merged[key] = finding
            output.append(finding)
            continue
        existing.evidence.edits.extend(edits)
        existing.evidence.note = f"同一差异在本组字幕出现 {len(existing.evidence.edits)} 次"
    return output


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
    t2s = bool(options.get("t2s", True))
    corpus, _ = normalize(" ".join(cue.text for cue in cues), t2s)
    glossary_terms = [
        key
        for term in (options.get("glossary") or [])
        if len(key := normalize(str(term), t2s)[0]) >= 3
    ]

    for alignment in bundle.alignments:
        content_edits = []
        content_spans = []
        term_edits = []
        letter_edits = []
        non_equal = [opcode for opcode in alignment.opcodes if opcode[0] != "equal"]
        cluster_size: list[int] = []
        for group in _clusters(non_equal):
            cluster_size.extend([len(group)] * len(group))
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
                    message="语音识别结果比字幕多出少量字词，可能是识别插入，也可能是字幕漏录；字幕内容未被否定，仅供参考。",
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
        for edit_index, (edit, (tag, i1, i2, j1, j2)) in enumerate(zip(alignment.edits, non_equal)):
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
                if _boundary_repeat(edit.asr_text, next_cue.text, suffix=False):
                    continue
            if tag == "insert" and j1 == 0 and previous_cue is not None:
                head, _ = normalize(edit.asr_text)
                before, _ = normalize(previous_cue.text)
                if head and before.endswith(head):
                    continue
                if _boundary_repeat(edit.asr_text, previous_cue.text, suffix=True):
                    continue
            confidence = _confidence(alignment, j1, j2)
            avg_logprob = _segment_logprob(alignment, segment_map, j1, j2)

            mixed_script = (
                not (_has_cjk(edit.sub_text) and _has_cjk(edit.asr_text))
                if tag == "replace"
                else not _has_cjk(edit.sub_text) and not _has_cjk(edit.asr_text)
            )
            if tag != "equal" and _has_cjk(alignment.sub_text) and mixed_script:
                # A clean one-token letter swap (CAN-L → CAN-D) is a content difference:
                # the narration may really read it differently. Garbled acronyms split
                # into several adjacent spans and stay a term-recognition note.
                clean_swap = (
                    tag == "replace"
                    and cluster_size[edit_index] == 1
                    and not _has_cjk(edit.sub_text)
                    and not _has_cjk(edit.asr_text)
                    and any(char.isalnum() for char in edit.sub_text)
                    and any(char.isalnum() for char in edit.asr_text)
                )
                if clean_swap:
                    letter_edits.append(
                        (
                            edit,
                            _ascii_token(alignment.sub_text, edit.sub_start, edit.sub_end),
                            _ascii_token(alignment.asr_text, edit.asr_start, edit.asr_end),
                        )
                    )
                    continue
                term_edits.append(edit)
                continue

            if tag == "replace" and _has_cjk(edit.sub_text) and _has_cjk(edit.asr_text):
                if abs(_cjk_len(edit.sub_text) - _cjk_len(edit.asr_text)) <= 1:
                    score, relation, sub_reading, asr_reading = similarity(
                        simplify(edit.sub_text), simplify(edit.asr_text)
                    )
                    pinyin_ok = score >= pinyin_threshold
                    exact_ok = relation in {"homophone", "tone"}
                    confidence_ok = confidence is not None and confidence >= threshold
                    segment_ok = avg_logprob >= -1.0
                    pairs = _phrase_pairs(alignment, i1, i2, j1, j2, corpus)
                    consistent = next(
                        (pair for pair in pairs if pair[0] >= 2 and pair[0] > pair[1]),
                        None,
                    )
                    best_sub, best_asr = max(
                        ((pair[0], pair[1]) for pair in pairs), default=(0, 0)
                    )
                    # A noisy group still proves a typo when the subtitle itself uses the
                    # spoken spelling elsewhere: the sheet is inconsistent at this spot.
                    corroborated = best_asr >= 2 and best_asr > best_sub
                    reliable = alignment_ok or corroborated
                    glossary_hit = _glossary_supports(alignment, i1, i2, j1, j2, glossary_terms)
                    if pinyin_ok:
                        evidence = _base_evidence(alignment, j1, j2)
                        evidence.edits = [edit]
                        evidence.pinyin = PinyinEvidence(
                            sub=sub_reading,
                            asr=asr_reading,
                            similarity=round(score, 3),
                            relation=relation,
                        )
                        if (
                            exact_ok
                            and reliable
                            and confidence_ok
                            and segment_ok
                            and consistent
                            and not glossary_hit
                        ):
                            # The subtitle uses this spelling consistently; the one-off ASR
                            # variant is far more likely to be a mishearing.
                            sub_count, asr_count, sub_phrase, asr_phrase = consistent
                            counter += 1
                            evidence.note = "字幕全文拼写一致，疑似 ASR 误识"
                            findings.append(
                                Finding(
                                    id=f"uncertain-{alignment.cue_ids[0]}-{counter}",
                                    kind="uncertain",
                                    severity="info",
                                    cue_ids=alignment.cue_ids,
                                    start_ms=alignment.start_ms,
                                    end_ms=alignment.end_ms,
                                    title="同音差异（疑似 ASR 误识）",
                                    message=(
                                        f"字幕「{edit.sub_text}」与识别「{edit.asr_text}」同音不一致；"
                                        f"字幕全文「{sub_phrase}」出现 {sub_count} 次、"
                                        f"「{asr_phrase}」{asr_count} 次，更可能是识别误差，仅供参考。"
                                    ),
                                    subtitle_text=alignment.sub_text,
                                    asr_text=alignment.asr_text,
                                    confidence=confidence,
                                    evidence=evidence,
                                )
                            )
                            continue
                        if exact_ok and reliable and confidence_ok and segment_ok:
                            # Token confidence cannot corroborate a homophone: Whisper is
                            # confident about the pronunciation, not the character. High
                            # severity needs the subtitle itself to use the ASR spelling.
                            severity = "high" if best_asr > best_sub or glossary_hit else "review"
                            suggestion = (
                                simplify(edit.asr_text)
                                if options.get("t2s", True)
                                else edit.asr_text
                            )
                            counter += 1
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
                                    suggestion=suggestion,
                                    evidence=evidence,
                                )
                            )
                            continue
                        # A CJK homophone/near-homophone disagreement cannot be asserted as a
                        # subtitle error without high confidence and a clean alignment.
                        counter += 1
                        if not exact_ok:
                            evidence.note = "声母/韵母相近，ASR 误识可能性较高"
                            title = "近音差异（疑似 ASR 误识）"
                            message = (
                                f"字幕「{edit.sub_text}」与识别「{edit.asr_text}」读音相近"
                                f"（相似度 {score:.2f}），更可能是 ASR 混淆，仅供参考。"
                            )
                        else:
                            evidence.note = "同音差异但证据不足，未判定为错别字"
                            title = (
                                "ASR 置信度不足"
                                if reliable and segment_ok
                                else "同音差异（证据不足）"
                            )
                            message = (
                                f"字幕「{edit.sub_text}」与识别「{edit.asr_text}」疑似同音，"
                                f"但词级置信度仅 {_confidence_label(confidence)}"
                                f"{'' if reliable else '、对齐不足'}，需人工确认。"
                            )
                        findings.append(
                            Finding(
                                id=f"uncertain-{alignment.cue_ids[0]}-{counter}",
                                kind="uncertain",
                                severity="info",
                                cue_ids=alignment.cue_ids,
                                start_ms=alignment.start_ms,
                                end_ms=alignment.end_ms,
                                title=title,
                                message=message,
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

        if (
            content_edits
            and not any(edit.op == "replace" for edit in content_edits)
            and total_chars <= 2
            and _cue_boundary_only(alignment, content_spans)
        ):
            counter += 1
            evidence = _base_evidence(alignment, 0, len(alignment.asr_word_ids))
            evidence.edits = content_edits
            evidence.note = "字幕断句差异"
            findings.append(
                Finding(
                    id=f"uncertain-{alignment.cue_ids[0]}-{counter}",
                    kind="uncertain",
                    severity="info",
                    cue_ids=alignment.cue_ids,
                    start_ms=alignment.start_ms,
                    end_ms=alignment.end_ms,
                    title="字幕断句差异",
                    message="差异位于相邻字幕的断句处，可能是换行把同一个词拆开；字幕内容未被否定，仅供参考。",
                    subtitle_text=alignment.sub_text,
                    asr_text=alignment.asr_text,
                    confidence=_confidence(alignment, 0, len(alignment.asr_word_ids)),
                    evidence=evidence,
                )
            )
            content_edits = []

        if content_edits:
            counter += 1
            confidence = _confidence(alignment, 0, len(alignment.asr_word_ids))
            if not alignment_ok or (confidence is not None and confidence < uncertain_threshold):
                # A low-confidence ASR reading cannot assert a subtitle error.
                severity = "info"
            else:
                severity = "high" if total_chars >= 8 else "review"
            evidence = _base_evidence(alignment, 0, len(alignment.asr_word_ids))
            evidence.edits = content_edits
            findings.append(
                Finding(
                    id=f"content-{alignment.cue_ids[0]}-{counter}",
                    kind="content",
                    severity=severity,
                    cue_ids=alignment.cue_ids,
                    start_ms=alignment.start_ms,
                    end_ms=alignment.end_ms,
                    title="字幕与语音不一致",
                    message="字幕文本与识别文本存在无法用同音字解释的差异，请核对。",
                    subtitle_text=alignment.sub_text,
                    asr_text=alignment.asr_text,
                    confidence=confidence,
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

        if letter_edits:
            counter += 1
            evidence = _base_evidence(alignment, 0, len(alignment.asr_word_ids))
            evidence.edits = [edit for edit, _, _ in letter_edits]
            evidence.note = "字母/数字写法差异"
            pairs = "、".join(
                dict.fromkeys(f"「{sub}」/「{asr}」" for _, sub, asr in letter_edits)
            )
            findings.append(
                Finding(
                    id=f"content-{alignment.cue_ids[0]}-{counter}",
                    kind="content",
                    severity="review",
                    cue_ids=alignment.cue_ids,
                    start_ms=alignment.start_ms,
                    end_ms=alignment.end_ms,
                    title="字母写法不一致",
                    message=(
                        f"字幕与语音识别在字母/数字上不一致（{pairs}），"
                        "可能是讲解读音与字幕不符，也可能是 ASR 误识，请对照音频确认。"
                    ),
                    subtitle_text=alignment.sub_text,
                    asr_text=alignment.asr_text,
                    confidence=_confidence(alignment, 0, len(alignment.asr_word_ids)),
                    evidence=evidence,
                )
            )

        if term_edits:
            counter += 1
            evidence = _base_evidence(alignment, 0, len(alignment.asr_word_ids))
            evidence.edits = term_edits
            evidence.note = "中英文/数字写法差异"
            findings.append(
                Finding(
                    id=f"uncertain-{alignment.cue_ids[0]}-{counter}",
                    kind="uncertain",
                    severity="info",
                    cue_ids=alignment.cue_ids,
                    start_ms=alignment.start_ms,
                    end_ms=alignment.end_ms,
                    title="术语识别差异",
                    message=(
                        "字幕与语音识别在字母、数字与汉字的写法上不一致，"
                        "通常为 ASR 对术语的误识；请对照画面确认。"
                    ),
                    subtitle_text=alignment.sub_text,
                    asr_text=alignment.asr_text,
                    confidence=_confidence(alignment, 0, len(alignment.asr_word_ids)),
                    evidence=evidence,
                )
            )

    for segment in segments:
        # no_speech_prob is shared by a whole 30s window; Whisper itself only trusts it
        # together with a low avg_logprob, so avg_logprob alone marks a weak decode.
        if segment.avg_logprob >= -1.0:
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
                    f"该语音段平均对数概率 {segment.avg_logprob:.2f}，识别质量偏低，结论仅供参考。"
                ),
                subtitle_text=" ".join(cue.text for cue in overlapping),
                asr_text=segment.text,
                confidence=round(
                    sum(word.probability for word in segment.words) / max(1, len(segment.words)), 4
                ),
                evidence=Evidence(edits=[], words=[], note="低置信度语音段"),
            )
        )

    return _merge_repeats(findings)


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
