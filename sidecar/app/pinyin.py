from __future__ import annotations

from functools import lru_cache

from pypinyin import Style, pinyin

INITIALS = (
    "zh",
    "ch",
    "sh",
    "b",
    "p",
    "m",
    "f",
    "d",
    "t",
    "n",
    "l",
    "g",
    "k",
    "h",
    "j",
    "q",
    "x",
    "r",
    "z",
    "c",
    "s",
    "y",
    "w",
)

INITIAL_CONFUSIONS = {
    frozenset(pair)
    for pair in (("zh", "z"), ("ch", "c"), ("sh", "s"), ("n", "l"), ("f", "h"), ("r", "l"))
}

FINAL_CONFUSIONS = {
    frozenset(pair)
    for pair in (
        ("an", "ang"),
        ("en", "eng"),
        ("in", "ing"),
        ("ian", "iang"),
        ("uan", "uang"),
        ("un", "ong"),
        ("ong", "eng"),
    )
}


def _is_cjk(char: str) -> bool:
    return "一" <= char <= "鿿"


def _split(syllable: str) -> tuple[str, str, str]:
    tone = syllable[-1] if syllable and syllable[-1].isdigit() else "5"
    base = syllable[:-1] if syllable and syllable[-1].isdigit() else syllable
    initial = ""
    for candidate in INITIALS:
        if base.startswith(candidate):
            initial = candidate
            break
    final = base[len(initial) :]
    return base, initial, final


def _pair_score(left: str, right: str) -> tuple[float, str]:
    if left == right:
        return 1.0, "homophone"
    left_base, left_initial, left_final = _split(left)
    right_base, right_initial, right_final = _split(right)
    if left_base == right_base:
        return 0.9, "tone"
    initial_confused = frozenset((left_initial, right_initial)) in INITIAL_CONFUSIONS
    final_confused = frozenset((left_final, right_final)) in FINAL_CONFUSIONS
    if left_initial == right_initial and final_confused:
        return 0.8, "confusion"
    if left_final == right_final and initial_confused:
        return 0.8, "confusion"
    if initial_confused and final_confused:
        return 0.75, "confusion"
    return 0.0, "none"


@lru_cache(maxsize=4096)
def char_readings(char: str) -> tuple[str, ...]:
    if not _is_cjk(char):
        return ()
    readings = pinyin(char, style=Style.TONE3, heteronym=True, neutral_tone_with_five=True)
    return tuple(reading for values in readings for reading in values if reading)


@lru_cache(maxsize=4096)
def primary_reading(char: str) -> str:
    """Single deterministic reading used for glossary matching; non-CJK compares as-is."""
    if not _is_cjk(char):
        return char.lower()
    values = pinyin(char, style=Style.TONE3, heteronym=False, neutral_tone_with_five=True)
    return values[0][0] if values and values[0] else char


def _best_pair(left: str, right: str) -> tuple[float, str]:
    best = (0.0, "none")
    for a in char_readings(left):
        for b in char_readings(right):
            score, relation = _pair_score(a, b)
            if score > best[0]:
                best = (score, relation)
    return best


def similarity(sub_text: str, asr_text: str) -> tuple[float, str, list[str], list[str]]:
    sub_chars = [char for char in sub_text if _is_cjk(char)]
    asr_chars = [char for char in asr_text if _is_cjk(char)]
    if not sub_chars or not asr_chars or abs(len(sub_chars) - len(asr_chars)) > 1:
        return 0.0, "none", [], []

    if len(sub_chars) == len(asr_chars):
        pairs = list(zip(sub_chars, asr_chars))
    else:
        shorter = sub_chars if len(sub_chars) < len(asr_chars) else asr_chars
        longer = asr_chars if len(sub_chars) < len(asr_chars) else sub_chars
        best_pairs: list[tuple[str, str]] = []
        best_total = -1.0
        for skip in range(len(longer)):
            trimmed = longer[:skip] + longer[skip + 1 :]
            total = sum(_best_pair(a, b)[0] for a, b in zip(shorter, trimmed))
            if total > best_total:
                best_total = total
                best_pairs = list(zip(shorter, trimmed))
        pairs = best_pairs

    if not pairs:
        return 0.0, "none", [], []

    total = 0.0
    weakest = 1.0
    has_unrelated = False
    for left, right in pairs:
        score, pair_relation = _best_pair(left, right)
        total += score
        weakest = min(weakest, score)
        has_unrelated = has_unrelated or pair_relation == "none"
    average = total / len(pairs)

    display_sub = [readings[0] if (readings := char_readings(char)) else char for char in sub_chars]
    display_asr = [readings[0] if (readings := char_readings(char)) else char for char in asr_chars]
    # The weakest character decides the relation; taking the first differing pair made
    # the verdict depend on character order.
    if average >= 0.99:
        relation = "homophone"
    elif weakest >= 0.9:
        relation = "tone"
    elif not has_unrelated:
        relation = "confusion"
    else:
        relation = "none"
    return average, relation, display_sub, display_asr
