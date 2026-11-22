import json

from pydantic import SecretStr

from islamic_rag import store
from islamic_rag.agent import orchestrator as orch
from islamic_rag.agent.trace import TraceCollector
from islamic_rag.llm.client import CompletionResult
from islamic_rag.retrieve import Candidate
from islamic_rag.settings import Settings
from islamic_rag.sources import default_registry

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
    return s


def _cand():
    return Candidate(
        id=RID, ids=[RID], sura=2, aya_start=255, aya_end=255, score=0.5,
        text_display="", text_index="", translation_fa="ترجمه", address="البقرة (2:255)",
        metadata={"surah_name": "البقرة"}, source="quran",
    )


class FakeClient:
    def __init__(self, reasoner="پاسخ [[REF:quran:2:255]]", gap=None, judge_label="Direct_Match"):
        self.key = SecretStr("sk-test-abcdef0123456789")
        self.model = "fake-model"
        self.reasoner = reasoner
        self.gap = gap or {"next_queries": [], "chain_doc_ids": [], "done": True}
        self.judge_label = judge_label
        self.gap_calls = 0
        self.reasoner_calls = 0

    def complete(self, messages, **kw):
        system = messages[0]["content"]
        if "decompose" in system:
            content = json.dumps({"subqueries": [{"role": "core", "query": "صبر"}]})
        elif "gap-detector" in system:
            self.gap_calls += 1
            content = json.dumps(self.gap)
        elif "verification judge" in system:
            content = json.dumps(
                {"results": [{"id": RID, "label": self.judge_label, "reason": "دلیل"}]}
            )
        else:
            self.reasoner_calls += 1
            content = self.reasoner
        return CompletionResult(content, 10, 5, self.model)


def _run(s, client, **kw):
    emit = TraceCollector()
    res = orch.run_agent(s, default_registry(), client, "صبر فضیلت است", emit=emit, **kw)
    return res, emit


def test_happy_path_evidence_and_refs(tmp_path, monkeypatch):
    s = _setup(tmp_path, monkeypatch)
    monkeypatch.setattr(orch, "retrieve_evidence", lambda *a, **k: [_cand()])
    client = FakeClient(reasoner="صبر فضیلت است [[REF:quran:2:255]]. ادعای بی‌پشتوانه [[REF:quran:99:999]].")
    res, emit = _run(s, client)
    assert len(res["evidence"]) == 1
    assert res["evidence"][0]["doc_id"] == RID
    assert res["evidence"][0]["tier"] == 1
    assert "[[REF:quran:2:255]]" in res["answer"]
    assert "quran:99:999" not in res["answer"]
    assert "ادعای بی‌پشتوانه" not in res["answer"]
    assert emit.of("ref_rejected")[0]["doc_id"] == "quran:99:999"
    assert "".join(d["delta"] for d in emit.of("text_delta")) == res["answer"]
    assert len(emit.of("evidence_payload")) == 1
    assert len(emit.of("cost")) >= 3
    assert res["meta"]["hops_used"] == 1


def test_hop_cap_enforced(tmp_path, monkeypatch):
    s = _setup(tmp_path, monkeypatch)
    monkeypatch.setattr(orch, "retrieve_evidence", lambda *a, **k: [_cand()])
    client = FakeClient(gap={"next_queries": ["شاهد مخالف"], "chain_doc_ids": [], "done": False})
    res, _emit = _run(s, client)
    assert res["meta"]["hops_used"] == s.agent_max_hops == 3
    assert client.gap_calls == 2


def test_unified_path_runs_gap_loop(tmp_path, monkeypatch):
    s = _setup(tmp_path, monkeypatch)
    monkeypatch.setattr(orch, "retrieve_evidence", lambda *a, **k: [_cand()])
    client = FakeClient()  # gap detector reports done=True with no follow-up queries
    res, _emit = _run(s, client)
    # One standard research path: the gap detector always runs, even when it stops early.
    assert client.gap_calls == 1
    assert res["meta"]["hops_used"] == 1
    assert client.reasoner_calls == 1
    assert "deep_research" not in res["meta"]


def test_rejected_label_excluded_from_evidence(tmp_path, monkeypatch):
    s = _setup(tmp_path, monkeypatch)
    monkeypatch.setattr(orch, "retrieve_evidence", lambda *a, **k: [_cand()])
    client = FakeClient(judge_label="Superficial_Match", reasoner="هیچ شاهدی یافت نشد.")
    res, emit = _run(s, client)
    assert res["evidence"] == []
    assert emit.of("evidence_payload") == []
    # Empty approved evidence => Reasoner is never called; honest message returned.
    assert client.reasoner_calls == 0
    assert res["answer"] == orch.NO_EVIDENCE_MESSAGE
    assert "".join(d["delta"] for d in emit.of("text_delta")) == orch.NO_EVIDENCE_MESSAGE


def test_scripture_stripped_from_answer(tmp_path, monkeypatch):
    s = _setup(tmp_path, monkeypatch)
    monkeypatch.setattr(orch, "retrieve_evidence", lambda *a, **k: [_cand()])
    client = FakeClient(reasoner="بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ [[REF:quran:2:255]]")
    res, _ = _run(s, client)
    assert "بِسْمِ" not in res["answer"]
    assert "[[REF:quran:2:255]]" in res["answer"]


def test_unified_path_triggers_rerank(tmp_path, monkeypatch):
    s = _setup(tmp_path, monkeypatch)
    monkeypatch.setattr(orch, "retrieve_evidence", lambda *a, **k: [_cand()])
    monkeypatch.setattr(orch, "reranker_available", lambda settings: True)
    calls = []
    monkeypatch.setattr(
        orch, "rerank_candidates", lambda settings, q, cands: calls.append(q) or cands
    )
    client = FakeClient()
    _run(s, client)
    # The single research path always reranks when the local model is available.
    assert len(calls) == 1


def test_cancel_stops_early(tmp_path, monkeypatch):
    import threading

    s = _setup(tmp_path, monkeypatch)
    monkeypatch.setattr(orch, "retrieve_evidence", lambda *a, **k: [_cand()])
    ev = threading.Event()
    ev.set()
    client = FakeClient()
    emit = TraceCollector()
    res = orch.run_agent(
        s, default_registry(), client, "صبر", emit=emit, cancel_event=ev
    )
    assert res["meta"]["cancelled"] is True
    assert res["answer"] == ""