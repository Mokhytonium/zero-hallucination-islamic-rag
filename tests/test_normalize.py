from islamic_rag.normalize import normalize, strip_bismillah


def test_strips_diacritics_and_pause_marks():
    assert normalize("بِسْمِ اللَّهِ الرَّحْمَـٰنِ الرَّحِيمِ") == "بسم الله الرحمن الرحيم"
    assert normalize("ذَٰلِكَ الْكِتَابُ لَا رَيْبَ ۛ فِيهِ ۛ هُدًى") == "ذلك الكتاب لا ريب فيه هدي"


def test_unifies_letters():
    assert normalize("أحمد إبراهيم آدم") == "احمد ابراهيم ادم"
    assert normalize("علی کردی") == "علي كردي"
    assert normalize("رحمة") == "رحمه"


def test_zwnj_becomes_space():
    assert normalize("می‌شود") == "مي شود"


def test_digits_unified():
    assert normalize("آیه ۲۵۵ و ٢٥٦") == "ايه 255 و 256"


def test_bismillah_stripped_only_from_first_ayah():
    assert strip_bismillah("بسم الله الرحمن الرحيم الم", 2, 1) == "الم"
    assert strip_bismillah("بسم الله الرحمن الرحيم", 1, 1) == "بسم الله الرحمن الرحيم"
    assert strip_bismillah("براءه من الله ورسوله", 9, 1) == "براءه من الله ورسوله"
    assert (
        strip_bismillah("انه من سليمان وانه بسم الله الرحمن الرحيم", 27, 30)
        == "انه من سليمان وانه بسم الله الرحمن الرحيم"
    )