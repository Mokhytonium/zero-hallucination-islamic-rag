from islamic_rag import store
from islamic_rag.retrieve import hybrid_candidates
from islamic_rag.settings import Settings


def _setup(tmp_path, monkeypatch):
    s = Settings()
    monkeypatch.setattr(s, "data_dir", tmp_path)
    monkeypatch.setattr(s, "use_reranker", False)
    con = store.connect(s.db_path)
    store.init_schema(con)
    for rid, src, sura, aya in [
        ("quran:2:255", "quran", 2, 255),
        ("other:1:1", "other", 1, 1),
    ]:
        con.execute(
            "INSERT INTO records(id, source, sura, aya, text_display, text_index, page, juz, prev_id, next_id, metadata) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (rid, src, sura, aya, "صبر فضیلت", "صبر فضيلت", 1, 1, None, None, "{}"),
        )
        con.execute(
            "INSERT INTO translations(record_id, translator_id, language, text_display, text_index) "
            "VALUES (?,?,?,?,?)",
            (rid, "fa.makarem", "fa", "صبر فضیلت", "صبر فضيلت"),
        )
    con.commit()
    store.rebuild_fts(con)
    con.close()
    return s


def test_sources_filter_keeps_only_requested(tmp_path, monkeypatch):
    s = _setup(tmp_path, monkeypatch)
    cands = hybrid_candidates(s, "صبر فضیلت", lexical_only=True, sources=["quran"])
    assert cands
    assert all(c.source == "quran" for c in cands)
    assert all(c.id.startswith("quran:") for c in cands)


def test_no_filter_returns_all_sources(tmp_path, monkeypatch):
    s = _setup(tmp_path, monkeypatch)
    cands = hybrid_candidates(s, "صبر فضیلت", lexical_only=True)
    assert {c.source for c in cands} == {"quran", "other"}


def test_candidate_source_defaults_to_quran():
    from islamic_rag.retrieve import Candidate

    c = Candidate(
        id="quran:1:1", ids=["quran:1:1"], sura=1, aya_start=1, aya_end=1, score=0.1,
        text_display="x", text_index="x", translation_fa="", address="a", metadata={},
    )
    assert c.source == "quran"