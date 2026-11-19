import json

import islamic_rag.pipeline as pl
from islamic_rag import store
from islamic_rag.pipeline import answer
from islamic_rag.retrieve import Candidate
from islamic_rag.settings import Settings

RID = "quran:2:255"


def _setup(tmp_path, monkeypatch):
    s = Settings()
    monkeypatch.setattr(s, "data_dir", tmp_path)
    con = store.connect(s.db_path)
    store.init_schema(con)
    con.execute(
        "INSERT INTO records(id, source, sura, aya, text_display, text_index, page, juz, prev_id, next_id, metadata) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (RID, "quran", 2, 255, "اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ", "allah la ilaha illa hu",
         42, 3, None, None, json.dumps({"surah_name": "البقرة"})),
    )
    con.execute(
        "INSERT INTO translations(record_id, translator_id, language, text_display, text_index) "
        "VALUES (?,?,?,?,?)",
        (RID, "fa.makarem", "fa", "ترجمه", "tr"),
    )
    con.commit()
    con.close()
    cand = Candidate(
        id=RID, ids=[RID], sura=2, aya_start=255, aya_end=255, score=0.5,
        text_display="", text_index="", translation_fa="", address="البقرة (2:255)",
        metadata={"surah_name": "البقرة"},
    )
    monkeypatch.setattr("islamic_rag.pipeline.hybrid_candidates", lambda *a, **k: [cand])
    return s


def _verdict(label):
    return [{"id": RID, "label": label, "reason": "دلیل"}]


def test_judge_failure_degrades_and_is_not_cached(tmp_path, monkeypatch):
    s = _setup(tmp_path, monkeypatch)

    def boom(*a, **k):
        raise RuntimeError("داور HTTP 403: quota exhausted")

    monkeypatch.setattr("islamic_rag.pipeline.call_judge", boom)
    res = answer(s, "گزاره", use_judge=True)
    assert res["status"] == "ok"
    assert res["meta"]["judge_error"]
    assert res["meta"]["judge_model"] is None
    assert len(res["sections"]["unverified"]) == 1
    assert res["sections"]["unverified"][0]["text_display"] == "اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ"

    monkeypatch.setattr("islamic_rag.pipeline.call_judge", lambda *a, **k: _verdict("Direct_Match"))
    again = answer(s, "گزاره", use_judge=True)
    assert not again.get("cached")
    assert len(again["sections"]["main"]) == 1


def test_empty_verdicts_flagged_as_judge_error(tmp_path, monkeypatch):
    s = _setup(tmp_path, monkeypatch)
    monkeypatch.setattr("islamic_rag.pipeline.call_judge", lambda *a, **k: [])
    res = answer(s, "گزاره", use_judge=True)
    assert res["meta"]["judge_error"]
    assert len(res["sections"]["unverified"]) == 1


def test_all_candidates_rejected_is_not_a_failure(tmp_path, monkeypatch):
    s = _setup(tmp_path, monkeypatch)
    monkeypatch.setattr(
        "islamic_rag.pipeline.call_judge", lambda *a, **k: _verdict("Superficial_Match")
    )
    res = answer(s, "گزاره", use_judge=True)
    assert res["meta"]["judge_error"] is None
    assert all(not v for v in res["sections"].values())


def test_success_is_cached_and_config_change_invalidates(tmp_path, monkeypatch):
    s = _setup(tmp_path, monkeypatch)
    monkeypatch.setattr("islamic_rag.pipeline.call_judge", lambda *a, **k: _verdict("Direct_Match"))
    first = answer(s, "گزاره", use_judge=True)
    assert not first.get("cached")
    assert answer(s, "گزاره", use_judge=True)["cached"] is True

    monkeypatch.setattr(s, "rerank_pool", s.rerank_pool + 1)
    assert not answer(s, "گزاره", use_judge=True).get("cached")

    monkeypatch.setattr(s, "primary_translation", "fa.ansarian")
    assert not answer(s, "گزاره", use_judge=True).get("cached")


def test_no_judge_mode_labels_unverified(tmp_path, monkeypatch):
    s = _setup(tmp_path, monkeypatch)
    res = answer(s, "گزاره", use_judge=False)
    assert res["meta"]["judge_model"] is None
    assert res["meta"]["judge_error"] is None
    assert len(res["sections"]["unverified"]) == 1
    assert res["meta"]["retrieval_s"] >= 0


def test_judge_prompt_change_invalidates_cache(tmp_path, monkeypatch):
    s = _setup(tmp_path, monkeypatch)
    monkeypatch.setattr("islamic_rag.pipeline.call_judge", lambda *a, **k: _verdict("Direct_Match"))
    assert not answer(s, "گزاره", use_judge=True).get("cached")
    assert answer(s, "گزاره", use_judge=True)["cached"] is True

    monkeypatch.setattr("islamic_rag.pipeline.SYSTEM_PROMPT", "tuned prompt")
    assert not answer(s, "گزاره", use_judge=True).get("cached")


def test_partial_verdicts_surface_missing_as_unverified(tmp_path, monkeypatch):
    s = _setup(tmp_path, monkeypatch)
    rid2 = "quran:2:256"
    con = store.connect(s.db_path)
    con.execute(
        "INSERT INTO records(id, source, sura, aya, text_display, text_index, page, juz, prev_id, next_id, metadata) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (rid2, "quran", 2, 256, "متن ۲۵۶", "text 256", 42, 3, None, None,
         json.dumps({"surah_name": "البقرة"})),
    )
    con.execute(
        "INSERT INTO translations(record_id, translator_id, language, text_display, text_index) "
        "VALUES (?,?,?,?,?)",
        (rid2, "fa.makarem", "fa", "ترجمه ۲۵۶", "tr2"),
    )
    con.commit()
    con.close()
    cand2 = Candidate(
        id=rid2, ids=[rid2], sura=2, aya_start=256, aya_end=256, score=0.4,
        text_display="", text_index="", translation_fa="", address="البقرة (2:256)",
        metadata={"surah_name": "البقرة"},
    )
    orig = pl.hybrid_candidates
    monkeypatch.setattr(pl, "hybrid_candidates", lambda *a, **k: [*orig(*a, **k), cand2])
    monkeypatch.setattr(pl, "call_judge", lambda *a, **k: _verdict("Direct_Match"))

    res = answer(s, "گزاره", use_judge=True)
    assert len(res["sections"]["main"]) == 1
    assert len(res["sections"]["unverified"]) == 1
    assert res["sections"]["unverified"][0]["id"] == rid2
    assert "حکمی صادر نکرد" in res["meta"]["judge_error"]
    assert res["meta"]["judge_model"] == s.judge_model

    again = answer(s, "گزاره", use_judge=True)
    assert not again.get("cached")