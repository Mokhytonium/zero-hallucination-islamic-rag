import json

from islamic_rag import judge, store
from islamic_rag.llm.client import CompletionResult
from islamic_rag.retrieve import Candidate
from islamic_rag.settings import Settings

RID = "quran:2:191"
CONTENT = json.dumps({"results": [{"id": RID, "reason": "دلیل", "label": "Direct_Match"}]})


def _setup(tmp_path, monkeypatch):
    s = Settings()
    monkeypatch.setattr(s, "data_dir", tmp_path)
    con = store.connect(s.db_path)
    store.init_schema(con)
    con.execute(
        "INSERT INTO records(id, source, sura, aya, text_display, text_index, page, juz, prev_id, next_id, metadata) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (RID, "quran", 2, 191, "نص", "text", 1, 1, None, None, "{}"),
    )
    con.execute(
        "INSERT INTO translations(record_id, translator_id, language, text_display, text_index) "
        "VALUES (?,?,?,?,?)",
        (RID, "fa.makarem", "fa", "ترجمه", "tr"),
    )
    con.commit()
    con.close()
    monkeypatch.setattr(judge.time, "sleep", lambda _s: None)
    return s


def _cand():
    return Candidate(
        id=RID, ids=[RID], sura=2, aya_start=191, aya_end=191, score=0.5,
        text_display="نص", text_index="text", translation_fa="ترجمه",
        address="البقرة (2:191)", metadata={},
    )


class _FakeClient:
    def __init__(self, content=CONTENT):
        self.content = content
        self.calls = 0

    def complete(self, messages, **kw):
        self.calls += 1
        assert kw["response_format"] == {"type": "json_object"}
        return CompletionResult(self.content, 10, 5, "byok-model")


def test_client_path_parses_and_logs_zero_cost(tmp_path, monkeypatch):
    s = _setup(tmp_path, monkeypatch)
    client = _FakeClient()
    out = judge.call_judge(s, "گزاره", [_cand()], client=client, enforce_budget=False)
    assert out[0]["label"] == "Direct_Match"
    assert client.calls == 1
    con = store.connect(s.db_path)
    row = con.execute("SELECT model, cost_usd FROM api_usage").fetchone()
    con.close()
    assert row["model"] == "byok-model"
    assert row["cost_usd"] == 0.0


def test_client_path_skips_budget_guard(tmp_path, monkeypatch):
    s = _setup(tmp_path, monkeypatch)
    monkeypatch.setattr(s, "budget_cap_usd", 0.0)

    def _no_pricing(*a, **k):
        raise AssertionError("pricing must not be consulted on the BYOK path")

    monkeypatch.setattr(judge, "_pricing", _no_pricing)
    out = judge.call_judge(s, "گزاره", [_cand()], client=_FakeClient(), enforce_budget=False)
    assert out[0]["label"] == "Direct_Match"


def test_client_empty_retries_then_returns_empty(tmp_path, monkeypatch):
    s = _setup(tmp_path, monkeypatch)
    client = _FakeClient(content="not json")
    out = judge.call_judge(s, "گزاره", [_cand()], client=client, enforce_budget=False)
    assert out == []
    assert client.calls == 5