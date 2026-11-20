from islamic_rag.agent.refs import chunk_text, clean_answer, extract_refs


def test_extract_refs():
    text = "الف [[REF:quran:2:255]] ب [[REF:quran:17:23]]"
    assert extract_refs(text) == ["quran:2:255", "quran:17:23"]


def test_clean_keeps_valid_drops_invalid():
    text = "خوب [[REF:quran:2:255]]. بد [[REF:quran:99:999]]."
    clean, rejected = clean_answer(text, {"quran:2:255"})
    assert "[[REF:quran:2:255]]" in clean
    assert "خوب" in clean
    # The whole sentence carrying the invalid tag is dropped, not left as a gap.
    assert "quran:99:999" not in clean
    assert "بد" not in clean
    assert rejected == ["quran:99:999"]


def test_clean_strips_scripture_and_secrets():
    key = "sk-or-v1-abcdef0123456789abcdef"
    text = f"بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ {key} [[REF:quran:1:1]]"
    clean, _ = clean_answer(text, {"quran:1:1"}, key=key)
    assert "بِسْمِ" not in clean
    assert key not in clean
    assert "[[REF:quran:1:1]]" in clean


def test_clean_preserves_persian_prose():
    text = "این یک پاسخ فارسی روان است بدون هیچ استنادی"
    clean, rejected = clean_answer(text, set())
    assert clean == text
    assert rejected == []


def test_chunk_text_reassembles():
    text = "الف" * 100
    assert "".join(chunk_text(text, 24)) == text
    assert all(len(c) <= 24 for c in chunk_text(text, 24))