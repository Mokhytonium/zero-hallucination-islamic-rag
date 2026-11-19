from islamic_rag import retrieve
from islamic_rag.retrieve import _fts_query, _merge_and_build, _query_weights
from islamic_rag.settings import Settings


def test_fts_query_drops_stopwords_and_keeps_content():
    fq = _fts_query("صبر در برابر مشکلات فضیلت است")
    assert fq is not None
    assert '"صبر"' in fq
    # normalize() unifies Persian ی/ک to Arabic ي/ك so FTS terms match the indexed text
    assert '"مشكلات"' in fq
    assert '"فضيلت"' in fq
    assert '"در"' not in fq
    assert '"است"' not in fq


def test_fts_query_none_when_only_stopwords():
    assert _fts_query("از به با در را و") is None
    assert _fts_query("") is None


def test_fts_query_strips_quotes_and_caps_tokens():
    fq = _fts_query('سلام "دوست" ' + " ".join(f"واژه{i}" for i in range(30)))
    terms = fq.split(" OR ")
    assert len(terms) <= 14
    assert all(t.startswith('"') and t.endswith('"') for t in terms)
    assert all('"' not in t[1:-1] for t in terms)


def test_query_weights_persian_markers():
    assert _query_weights("غیبت کردن کار خوبی است")["dense_fa"] == 2.0
    assert _query_weights("الحمد لله رب العالمين")["dense_ar"] == 2.0


def _record(rid: str, sura: int, aya: int) -> dict:
    return {
        "id": rid,
        "sura": sura,
        "aya": aya,
        "text_display": f"نص {sura}:{aya}",
        "text_index": f"نص {sura}:{aya}",
        "metadata": '{"surah_name": "بقره"}',
    }


def _patch_store(monkeypatch, records: dict, translations: dict):
    monkeypatch.setattr(retrieve.store, "get_records", lambda con, ids: records)
    monkeypatch.setattr(
        retrieve.store, "get_translation", lambda con, rid, name: translations.get(rid)
    )


def test_merge_consecutive_ayat_into_one_passage(monkeypatch):
    records = {r["id"]: r for r in [_record("quran:2:255", 2, 255), _record("quran:2:256", 2, 256)]}
    translations = {
        "quran:2:255": {"text_display": "ترجمه ۲۵۵"},
        "quran:2:256": {"text_display": "ترجمه ۲۵۶"},
    }
    _patch_store(monkeypatch, records, translations)
    scores = {"quran:2:255": 0.4, "quran:2:256": 0.9}
    cands = _merge_and_build(None, list(records), scores, Settings())
    assert len(cands) == 1
    c = cands[0]
    assert c.id == "quran:2:255"
    assert c.ids == ["quran:2:255", "quran:2:256"]
    assert c.aya_start == 255 and c.aya_end == 256
    assert c.address == "بقره (2:255-256)"
    assert c.score == 0.9
    assert c.text_display == "نص 2:255 نص 2:256"
    assert c.translation_fa == "ترجمه ۲۵۵ ترجمه ۲۵۶"


def test_merge_keeps_non_consecutive_ayat_separate(monkeypatch):
    records = {r["id"]: r for r in [_record("quran:2:255", 2, 255), _record("quran:2:260", 2, 260)]}
    _patch_store(monkeypatch, records, {})
    cands = _merge_and_build(None, list(records), {"quran:2:255": 0.8, "quran:2:260": 0.2}, Settings())
    assert len(cands) == 2
    assert [c.id for c in cands] == ["quran:2:255", "quran:2:260"]
    assert cands[0].address == "بقره (2:255)"
    assert cands[0].translation_fa == ""


def test_merge_does_not_join_across_suras(monkeypatch):
    records = {r["id"]: r for r in [_record("quran:2:286", 2, 286), _record("quran:3:1", 3, 1)]}
    _patch_store(monkeypatch, records, {})
    cands = _merge_and_build(None, list(records), {}, Settings())
    assert len(cands) == 2
    assert all(len(c.ids) == 1 for c in cands)


def test_merge_skips_missing_records(monkeypatch):
    records = {"quran:2:255": _record("quran:2:255", 2, 255)}
    _patch_store(monkeypatch, records, {})
    cands = _merge_and_build(None, ["quran:2:255", "quran:99:999"], {}, Settings())
    assert [c.id for c in cands] == ["quran:2:255"]