import json

from islamic_rag import store
from islamic_rag.retrieve import Candidate
from islamic_rag.settings import Settings
from islamic_rag.sources import QuranSource, SourceRegistry, default_registry


def _setup(tmp_path, monkeypatch):
    s = Settings()
    monkeypatch.setattr(s, "data_dir", tmp_path)
    con = store.connect(s.db_path)
    store.init_schema(con)
    rows = [
        ("quran:2:255", 255, None, "quran:2:256"),
        ("quran:2:256", 256, "quran:2:255", "quran:2:257"),
        ("quran:2:257", 257, "quran:2:256", None),
    ]
    for rid, aya, prev, nxt in rows:
        con.execute(
            "INSERT INTO records(id, source, sura, aya, text_display, text_index, page, juz, prev_id, next_id, metadata) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (rid, "quran", 2, aya, f"نص {aya}", f"نص {aya}", 42, 3, prev, nxt,
             json.dumps({"surah_name": "البقرة"})),
        )
        con.execute(
            "INSERT INTO translations(record_id, translator_id, language, text_display, text_index) "
            "VALUES (?,?,?,?,?)",
            (rid, "fa.makarem", "fa", f"ترجمه {aya}", f"tr {aya}"),
        )
    con.commit()
    con.close()
    return s


def _cand(rid="quran:2:256", ids=None):
    ids = ids or [rid]
    return Candidate(
        id=rid, ids=ids, sura=2, aya_start=256, aya_end=256, score=0.5,
        text_display="", text_index="", translation_fa="", address="البقرة (2:256)",
        metadata={"surah_name": "البقرة"}, source="quran",
    )


def test_default_registry_has_quran_tier1():
    reg = default_registry()
    assert reg.ids() == ["quran"]
    assert reg.get("quran").tier == 1
    assert isinstance(reg.get("quran"), QuranSource)


def test_hydrate_augments_payload(tmp_path, monkeypatch):
    s = _setup(tmp_path, monkeypatch)
    reg = default_registry()
    con = store.connect(s.db_path)
    payload = reg.hydrate(con, _cand(), "Direct_Match", s, "دلیل")
    con.close()
    assert payload["doc_id"] == "quran:2:256"
    assert payload["tier"] == 1
    assert payload["external_url"] == "https://quran.com/2/256"
    assert payload["tafsir_snippet"] is None
    assert payload["text_display"] == "نص 256"
    assert payload["translation_fa"] == "ترجمه 256"
    assert payload["context"]["before"]["id"] == "quran:2:255"
    assert payload["context"]["after"]["id"] == "quran:2:257"


def test_validate_ref(tmp_path, monkeypatch):
    s = _setup(tmp_path, monkeypatch)
    reg = default_registry()
    con = store.connect(s.db_path)
    assert reg.validate_ref(con, "quran:2:256") is True
    assert reg.validate_ref(con, "quran:99:999") is False
    assert reg.validate_ref(con, "unknown:1:1") is False
    con.close()


def test_get_context_chains_neighbors(tmp_path, monkeypatch):
    s = _setup(tmp_path, monkeypatch)
    ctx = QuranSource().get_context(s, "quran:2:256")
    assert ctx["verse"]["id"] == "quran:2:256"
    assert ctx["before"]["id"] == "quran:2:255"
    assert ctx["after"]["id"] == "quran:2:257"


def test_light_search_uses_hop_settings(tmp_path, monkeypatch):
    s = _setup(tmp_path, monkeypatch)
    captured = {}

    def fake_hybrid(settings, query, k=None, sources=None):
        captured["settings"] = settings
        captured["sources"] = sources
        return [_cand()]

    monkeypatch.setattr("islamic_rag.sources.quran.hybrid_candidates", fake_hybrid)
    out = QuranSource().search(s, "گزاره", light=True)
    assert out[0].id == "quran:2:256"
    assert captured["sources"] == ["quran"]
    assert captured["settings"].use_reranker is False
    assert captured["settings"].retrieval_pool == s.hop_retrieval_pool
    assert captured["settings"].top_k == s.hop_top_k


def test_unregistered_source_raises(tmp_path, monkeypatch):
    s = _setup(tmp_path, monkeypatch)
    reg = SourceRegistry()
    con = store.connect(s.db_path)
    cand = _cand()
    cand.source = "ghost"
    try:
        reg.hydrate(con, cand, "Direct_Match", s)
        raise AssertionError("expected KeyError")
    except KeyError:
        pass
    finally:
        con.close()