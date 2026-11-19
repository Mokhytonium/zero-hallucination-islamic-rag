import re

_ZWNJ = chr(0x200C)
_FORMAT_CHARS = re.compile("[" + "".join(chr(c) for c in (0x061C, 0x200E, 0x200F, 0x200D, 0xFEFF)) + "]")
_DIACRITICS = re.compile(
    "["
    + f"{chr(0x064B)}-{chr(0x065F)}"
    + chr(0x0670)
    + f"{chr(0x06D6)}-{chr(0x06ED)}"
    + f"{chr(0x08F0)}-{chr(0x08F3)}"
    + chr(0x0640)
    + "]"
)
_WHITESPACE = re.compile(r"\s+")

_CHAR_MAP = str.maketrans(
    {
        "أ": "ا",
        "إ": "ا",
        "آ": "ا",
        "ٱ": "ا",
        "ى": "ي",
        "ی": "ي",
        "ک": "ك",
        "ة": "ه",
    }
)

_DIGITS = str.maketrans(
    "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹",
    "01234567890123456789",
)

_BISMILLAH = re.compile(r"^بسم\s+الله\s+الرحمن\s+الرحيم\s*")


def normalize(text: str) -> str:
    text = text.replace(_ZWNJ, " ")
    text = _FORMAT_CHARS.sub("", text)
    text = _DIACRITICS.sub("", text)
    text = text.translate(_CHAR_MAP)
    text = text.translate(_DIGITS)
    return _WHITESPACE.sub(" ", text).strip()


def strip_bismillah(text_index: str, sura: int, aya: int) -> str:
    if aya == 1 and sura not in (1, 9):
        return _BISMILLAH.sub("", text_index, count=1).strip()
    return text_index