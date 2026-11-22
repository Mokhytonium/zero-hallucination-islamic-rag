import difflib
import re
from collections.abc import Iterator

from ..llm.sanitize import ArabicStrippingSanitizer, redact_secrets

REF_RE = re.compile(r"\[\[REF:([^\[\]]+?)\]\]")
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?؟\n])")

# --- duplicate-translation guard -------------------------------------------
# The rendering layer already shows the Persian translation inside the verse
# card, so any translation the reasoner retypes in its prose appears twice.
# These helpers remove such copied spans while keeping the framing and the tag.

_WORD_RE = re.compile(r"[^\W_]+", re.UNICODE)
_TASHKEEL_FOR_MATCH = re.compile(r"[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]")
_CHAR_FOLD = str.maketrans({
    "ي": "ی",
    "ك": "ک",
    "ۀ": "ه",
    "أ": "ا",
    "إ": "ا",
    "آ": "ا",
    "ٱ": "ا",
    "\u200c": " ",
})
_MIN_MATCH_WORDS = 6
_QUOTED_RE = re.compile(r"«([^«»]{8,})»|“([^“”]{8,})”")
_FILLER = set(" \t«»“”()،؛.!?؟:—-\u200c")


def _expand_span(text: str, start: int, end: int) -> tuple[int, int]:
    """Grow a deleted span over adjacent punctuation so no debris is left."""
    while start > 0 and text[start - 1] in _FILLER:
        start -= 1
    while end < len(text) and text[end] in _FILLER:
        end += 1
    return start, end


def _match_words(text: str) -> list[str]:
    """Normalized word list used only for fuzzy comparison, never for output."""
    folded = _TASHKEEL_FOR_MATCH.sub("", text).translate(_CHAR_FOLD)
    return [w for w in _WORD_RE.findall(folded.lower())]


def _overlap_ratio(words: list[str], target: list[str]) -> float:
    if not words or not target:
        return 0.0
    wanted = set(words)
    found = wanted.intersection(target)
    return len(found) / len(wanted)


def _merge_spans(spans: list[tuple[int, int]]) -> list[tuple[int, int]]:
    merged: list[tuple[int, int]] = []
    for start, end in sorted(spans):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def _subtract_protected(
    spans: list[tuple[int, int]], protected: list[tuple[int, int]]
) -> list[tuple[int, int]]:
    """Never delete a REF tag while removing a duplicate translation."""
    pieces = list(spans)
    for p_start, p_end in protected:
        remaining: list[tuple[int, int]] = []
        for start, end in pieces:
            if p_end <= start or p_start >= end:
                remaining.append((start, end))
                continue
            if start < p_start:
                remaining.append((start, p_start))
            if p_end < end:
                remaining.append((p_end, end))
        pieces = remaining
    return pieces


def _strip_duplicates(text: str, translations: list[list[str]]) -> str:
    tag_spans = [m.span() for m in REF_RE.finditer(text)]

    def in_tag(pos: int) -> bool:
        return any(start <= pos < end for start, end in tag_spans)

    spans: list[tuple[int, int]] = []

    # 1) A quoted passage that is (mostly) the verse translation. Quotes are
    #    matched over the whole answer: their internal «!»/«؟» must not detach
    #    them from the REF tag that follows.
    for q in _QUOTED_RE.finditer(text):
        inner = _match_words(q.group(1) or q.group(2) or "")
        if len(inner) < 4:
            continue
        if any(_overlap_ratio(inner, target) >= 0.65 for target in translations):
            spans.append(q.span())

    # 2) An unquoted paragraph that reproduces (almost) the whole translation
    #    of a cited verse. Conservative: we only cut the exact matching run,
    #    and only when it covers >=80% of the verse translation, so paraphrases
    #    are never chopped up word by word.
    offset = 0
    for sentence in _SENTENCE_SPLIT.split(text):
        if sentence:
            tokens = [
                (offset + m.start(), offset + m.end())
                for m in _WORD_RE.finditer(sentence)
                if not in_tag(offset + m.start())
            ]
            sent_words = [_match_words(text[start:end]) for start, end in tokens]
            flat = [w for group in sent_words for w in group]
            positions = [i for i, group in enumerate(sent_words) for _ in group]
            for target in translations:
                if not target:
                    continue
                matcher = difflib.SequenceMatcher(None, flat, target, autojunk=False)
                block = max(matcher.get_matching_blocks(), key=lambda b: b.size)
                if block.size < 6 or block.size / len(target) < 0.8:
                    continue
                first = positions[block.a]
                last = positions[block.a + block.size - 1]
                spans.append(_expand_span(text, tokens[first][0], tokens[last][1]))
        offset += len(sentence)

    if not spans:
        return text

    out: list[str] = []
    cursor = 0
    for start, end in _merge_spans(_subtract_protected(spans, tag_spans)):
        out.append(text[cursor:start])
        cursor = end
    out.append(text[cursor:])
    cleaned = "".join(out)
    cleaned = re.sub(r"[«“”]\s*(?:[،؛.!?؟:]\s*)*[«“”]", "", cleaned)
    cleaned = re.sub(r"(\S)(\[\[REF:)", r"\1 \2", cleaned)
    cleaned = re.sub(r"(\]\])(?=[^\s.،؛!?؟:])", r"\1 ", cleaned)
    cleaned = re.sub(r"[ \t]+([،؛.!?؟:])", r"\1", cleaned)
    cleaned = re.sub(r"([،؛.!?؟:])(?:[ \t]*[،؛.!?؟:])+", r"\1", cleaned)
    cleaned = re.sub(r"\(\s*\)", "", cleaned)
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    cleaned = "\n".join(
        line for line in cleaned.split("\n") if not line.strip() or _WORD_RE.search(line)
    )
    if not re.sub(r"[\s،؛.!?؟:«»“”\-—()]+", "", cleaned):
        return ""
    return cleaned


def strip_duplicate_verse_text(text: str, translations: dict[str, str]) -> str:
    """Remove verse translations the reasoner retyped before/after its [[REF]] tag.

    The verse card renders the byte-exact translation from the database, so the
    same Persian text in the prose is always a duplicate. Only translations of
    verses actually cited in the answer are targeted; framing sentences and the
    tags themselves are preserved."""
    prepared = {
        doc_id: _match_words(value)
        for doc_id, value in (translations or {}).items()
        if value
    }
    if not prepared:
        return text
    cited = {t.strip() for t in REF_RE.findall(text)}
    targets = [prepared[d] for d in cited if d in prepared]
    if not targets:
        return text
    return _strip_duplicates(text, targets)


def extract_refs(text: str) -> list[str]:
    return REF_RE.findall(text)


def clean_answer(
    text: str,
    valid_doc_ids: set[str],
    sanitizer: ArabicStrippingSanitizer | None = None,
    key: str = "",
    translations: dict[str, str] | None = None,
) -> tuple[str, list[str]]:
    """Strip model-produced scripture and secrets, then enforce grounding at the
    sentence level: any sentence carrying a REF whose doc_id is not in the approved
    evidence dictionary is dropped whole (never left as a gap). Valid tags are
    preserved for client-side card rendering. When `translations` is given, verse
    translations retyped by the model are removed so the card is the only place
    the translation appears. Returns (clean_text, rejected_doc_ids)."""
    san = sanitizer or ArabicStrippingSanitizer()
    out = san.clean(text)
    out = redact_secrets(out, key)
    rejected: list[str] = []
    kept: list[str] = []

    for sentence in _SENTENCE_SPLIT.split(out):
        if not sentence:
            continue
        bad = [t.strip() for t in REF_RE.findall(sentence) if t.strip() not in valid_doc_ids]
        if bad:
            for doc_id in bad:
                if doc_id not in rejected:
                    rejected.append(doc_id)
            continue
        kept.append(sentence)

    result = "".join(kept)
    if translations:
        result = strip_duplicate_verse_text(result, translations)
    result = re.sub(r"[ \t]{2,}", " ", result)
    result = re.sub(r" +\n", "\n", result)
    return result.strip(), rejected


def chunk_text(text: str, size: int = 24) -> Iterator[str]:
    for i in range(0, len(text), size):
        yield text[i : i + size]