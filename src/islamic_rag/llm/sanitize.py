import re

# API-key shapes that must never reach a log, an SSE frame, or an error message.
_KEY_PATTERNS = (
    re.compile(r"sk-[A-Za-z0-9_\-]{12,}"),
    re.compile(r"Bearer\s+[A-Za-z0-9_\-\.]{12,}", re.IGNORECASE),
    re.compile(r"AIza[A-Za-z0-9_\-]{20,}"),
)

# Arabic-script letters (includes the Persian additions پ چ ژ گ ک ی).
_ARABIC_LETTER = r"؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿"
# Tashkeel / Quranic annotation marks — the signature of diacritized scripture.
_TASHKEEL = r"ً-ٰٟۖ-ࣰۭ-ࣿ"

# A scripture run: Arabic letters carrying multiple tashkeel marks. Persian prose
# is normally unvocalized, so this targets diacritized Quranic text only.
_SCRIPTURE_RUN = re.compile(
    rf"[{_ARABIC_LETTER}{_TASHKEEL}\s]{{8,}}"
)
_TASHKEEL_RE = re.compile(rf"[{_TASHKEEL}]")
_LETTER_RE = re.compile(rf"[{_ARABIC_LETTER}]")


def redact_secrets(text: str, *keys: str) -> str:
    out = text
    for key in keys:
        if key and len(key) >= 8:
            out = out.replace(key, "[REDACTED]")
    for pat in _KEY_PATTERNS:
        out = pat.sub("[REDACTED]", out)
    return out


def _is_scripture(run: str) -> bool:
    letters = len(_LETTER_RE.findall(run))
    marks = len(_TASHKEEL_RE.findall(run))
    return letters >= 8 and marks >= 2


class ArabicStrippingSanitizer:
    """Defense-in-depth: remove diacritized scripture the reasoner may emit.

    The structural 0% guarantee is dictionary-only rendering on the client; this
    server-side layer additionally strips vocalized Arabic runs so model-produced
    scripture never streams as prose. Unvocalized Persian prose passes through.
    """

    def clean(self, text: str) -> str:
        return _SCRIPTURE_RUN.sub(lambda m: "" if _is_scripture(m.group(0)) else m.group(0), text)

    def contains_scripture(self, text: str) -> bool:
        return any(_is_scripture(m.group(0)) for m in _SCRIPTURE_RUN.finditer(text))