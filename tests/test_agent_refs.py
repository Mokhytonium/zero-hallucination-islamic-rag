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


def test_clean_drops_translation_retyped_after_tag():
    translation = "مگر کسی که به کفر مجبور شود و قلبش به ایمان مطمئن باشد"
    text = f"قرآن در ماجرای اکراه بر کفر می‌فرماید: [[REF:quran:16:106]] {translation}."
    clean, _ = clean_answer(
        text, {"quran:16:106"}, translations={"quran:16:106": translation}
    )
    assert translation not in clean
    assert "قرآن در ماجرای اکراه بر کفر می‌فرماید" in clean
    assert "[[REF:quran:16:106]]" in clean


def test_clean_drops_quoted_translation_before_tag():
    translation = "خداوندی جز او نیست"
    text = f"قرآن می‌فرماید: «{translation}» [[REF:quran:2:255]]. این آیه توحید را بیان می‌کند."
    clean, _ = clean_answer(text, {"quran:2:255"}, translations={"quran:2:255": translation})
    assert translation not in clean
    assert "«»" not in clean
    assert "[[REF:quran:2:255]]" in clean
    assert "این آیه توحید را بیان می‌کند" in clean


def test_clean_drops_quoted_translation_with_inner_punctuation():
    translation = "وای بر شما! دروغ بر خدا نبندید، که شما را با عذابی نابود می‌سازد!"
    text = (
        "قرآن دروغ بستن بر خدا را نهی می‌کند و می‌فرماید: «"
        + translation
        + "»\n[[REF:quran:20:61]]\n"
    )
    clean, _ = clean_answer(text, {"quran:20:61"}, translations={"quran:20:61": translation})
    assert "وای بر شما" not in clean
    assert "[[REF:quran:20:61]]" in clean
    assert "دروغ بستن بر خدا را نهی می‌کند" in clean


def test_clean_keeps_all_tags_when_removing_duplicates():
    translations = {
        "quran:20:61": "وای بر شما! دروغ بر خدا نبندید!",
        "quran:2:42": "و حق را با باطل نیامیزید!",
    }
    text = (
        "دروغ بر خدا می‌فرماید: «وای بر شما! دروغ بر خدا نبندید!» [[REF:quran:20:61]]\n"
        "و درباره‌ی حق: «و حق را با باطل نیامیزید!» [[REF:quran:2:42]]\n"
    )
    clean, _ = clean_answer(text, set(translations), translations=translations)
    assert clean.count("[[REF:") == 2
    assert "«" not in clean and "»" not in clean


def test_clean_keeps_prose_when_translation_differs():
    translation = "و پروردگارت فرمان داده است که جز او را نپرستید"
    text = "قرآن درباره‌ی توحید می‌فرماید: [[REF:quran:17:23]] این اصل، بنیاد همه‌ی احکام است."
    clean, _ = clean_answer(text, {"quran:17:23"}, translations={"quran:17:23": translation})
    assert clean == text


def test_chunk_text_reassembles():
    text = "الف" * 100
    assert "".join(chunk_text(text, 24)) == text
    assert all(len(c) <= 24 for c in chunk_text(text, 24))