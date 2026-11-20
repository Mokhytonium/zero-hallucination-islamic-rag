from islamic_rag.llm.sanitize import ArabicStrippingSanitizer, redact_secrets

KEY = "sk-or-v1-abcdef0123456789abcdef0123456789"


def test_redacts_explicit_key():
    out = redact_secrets(f"Authorization failed for {KEY}", KEY)
    assert KEY not in out
    assert "[REDACTED]" in out


def test_redacts_key_pattern_without_hint():
    out = redact_secrets(f"leaked {KEY} in log")
    assert KEY not in out


def test_redacts_google_and_bearer():
    assert "AIza" not in redact_secrets("key AIzaSyD1234567890abcdefghij")
    assert "Bearer" not in redact_secrets("Bearer abcdef0123456789xyz")


def test_strips_diacritized_scripture():
    san = ArabicStrippingSanitizer()
    text = "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ"
    assert san.contains_scripture(text)
    assert san.clean(text).strip() == ""


def test_preserves_persian_prose():
    san = ArabicStrippingSanitizer()
    text = "این یک گزاره فارسی است که باید بدون تغییر عبور کند"
    assert not san.contains_scripture(text)
    assert san.clean(text) == text


def test_preserves_unvocalized_arabic_names():
    san = ArabicStrippingSanitizer()
    text = "سوره البقره در جزء اول قرار دارد"
    assert san.clean(text) == text