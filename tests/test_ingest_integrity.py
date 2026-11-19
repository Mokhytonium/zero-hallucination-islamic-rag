import pytest

from islamic_rag.ingest import _validate_textual_integrity


def _surah(i=52, name="الطور", type_="Meccan"):
    return {"id": i, "name": name, "type": type_}


def test_clean_data_passes():
    _validate_textual_integrity({(2, 45): "واستعينوا بالصبر والصلاة"}, [_surah()])


def test_latin_in_index_text_rejected():
    with pytest.raises(ValueError, match="2:45"):
        _validate_textual_integrity({(2, 45): "181-TRIAL-واستعينوا 27"}, [_surah()])


def test_corrupt_surah_type_rejected():
    with pytest.raises(ValueError, match="52"):
        _validate_textual_integrity({}, [_surah(type_="78-TRIAL-Meccan 258")])


def test_corrupt_surah_name_rejected():
    with pytest.raises(ValueError, match="52"):
        _validate_textual_integrity({}, [_surah(name="41-TRIAL-الطور 167")])