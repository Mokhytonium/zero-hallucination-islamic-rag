import re
from collections.abc import Iterator

from ..llm.sanitize import ArabicStrippingSanitizer, redact_secrets

REF_RE = re.compile(r"\[\[REF:([^\[\]]+?)\]\]")
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?؟\n])")


def extract_refs(text: str) -> list[str]:
    return REF_RE.findall(text)


def clean_answer(
    text: str,
    valid_doc_ids: set[str],
    sanitizer: ArabicStrippingSanitizer | None = None,
    key: str = "",
) -> tuple[str, list[str]]:
    """Strip model-produced scripture and secrets, then enforce grounding at the
    sentence level: any sentence carrying a REF whose doc_id is not in the approved
    evidence dictionary is dropped whole (never left as a gap). Valid tags are
    preserved for client-side card rendering. Returns (clean_text, rejected_doc_ids)."""
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
    result = re.sub(r"[ \t]{2,}", " ", result)
    result = re.sub(r" +\n", "\n", result)
    return result.strip(), rejected


def chunk_text(text: str, size: int = 24) -> Iterator[str]:
    for i in range(0, len(text), size):
        yield text[i : i + size]