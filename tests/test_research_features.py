import json

from islamic_rag import store
from islamic_rag.pipeline import _hydrate, _verse_view
from islamic_rag.rerank import reranker_available
from islamic_rag.retrieve import Candidate
from islamic_rag.settings import Settings


def _seed(con):
    store.init_schema(con)
    rows = [
        ("quran:2:254", 254, None, "quran:2:255", "آیه پیش", "ayeh pish"),
        ("quran:2:255", 255, "quran:2:254", "quran:2:256", "اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ", "allah la ilaha illa hu"),
        ("quran:2:256", 256, "quran:2:255", None, "آیه پس", "ayeh pas"),
    ]
    for rid, aya, prev, nxt, disp, idx in rows:
        con.execute(
            "INSERT INTO records(id, source, sura, aya, text_display, text_index, page, juz, prev_id, next_id, metadata) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (rid, "quran", 2, aya, disp, idx, 42, 3, prev, nxt, json.dumps({"surah_name": "البقرة", "revelation_place": "Medinan"})),
        )
        con.execute(
            "INSERT INTO translations(record_id, translator_id, language, text_display, text_index) "
            "VALUES (?,?,?,?,?)",
            (rid, "fa.makarem", "fa", "ترجمه " + disp, "tr " + idx),
        )
    con.commit()


def _cand(ids, score=0.12345):
    return Candidate(
        id=ids[0], ids=ids, sura=2, aya_start=255, aya_end=255, score=score,
        text_display="", text_index="", translation_fa="", address="البقرة (2:255)",
        metadata={"surah_name": "البقرة", "revelation_place": "Medinan"},
    )


def test_verse_view_byte_exact():
    con = store.connect(":memory:")
    _seed(con)
    v = _verse_view(con, "quran:2:255", Settings())
    assert v["text_display"] == "اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ"
    assert v["address"] == "البقرة (2:255)"
    assert v["translation_fa"] == "ترجمه اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ"
    assert _verse_view(con, "", Settings()) is None
    assert _verse_view(con, "quran:99:99", Settings()) is None
    con.close()


def test_hydrate_context_and_reason():
    con = store.connect(":memory:")
    _seed(con)
    out = _hydrate(con, _cand(["quran:2:255"]), "Direct_Match", Settings(), reason="تطبیق دارد")
    assert out["label"] == "Direct_Match"
    assert out["reason"] == "تطبیق دارد"
    assert out["score"] == 0.1235
    assert out["text_display"] == "اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ"
    assert out["context"]["before"]["id"] == "quran:2:254"
    assert out["context"]["after"]["id"] == "quran:2:256"
    assert out["context"]["before"]["text_display"] == "آیه پیش"
    con.close()


def test_hydrate_multi_verse_and_boundary():
    con = store.connect(":memory:")
    _seed(con)
    out = _hydrate(con, _cand(["quran:2:255", "quran:2:256"]), "Conditional_Match", Settings())
    assert out["text_display"] == "اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ آیه پس"
    assert out["context"]["before"]["id"] == "quran:2:254"
    assert out["context"]["after"] is None
    first = _hydrate(con, _cand(["quran:2:254"]), "Direct_Match", Settings())
    assert first["context"]["before"] is None
    con.close()


def test_reranker_available_guards_partial_download(tmp_path, monkeypatch):
    s = Settings()
    monkeypatch.setattr(s, "data_dir", tmp_path)
    local = tmp_path / "models" / "bge-reranker-v2-m3"
    local.mkdir(parents=True)
    f = local / "model.safetensors"
    assert reranker_available(s) is False
    f.write_bytes(b"partial")
    assert reranker_available(s) is False
    import islamic_rag.rerank as rr

    monkeypatch.setattr(rr, "_EXPECTED_BYTES", 7)
    f.write_bytes(b"1234567")
    assert reranker_available(s) is True