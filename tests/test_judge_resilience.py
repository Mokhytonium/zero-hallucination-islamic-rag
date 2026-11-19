import httpx
import pytest

from islamic_rag import judge, store
from islamic_rag.retrieve import Candidate
from islamic_rag.settings import Settings

CONTENT = '{"results":[{"id":"quran:2:191","reason":"دلیل","label":"Direct_Match"}]}'


def _setup(tmp_path, monkeypatch):
    s = Settings()
    monkeypatch.setattr(s, "data_dir", tmp_path)
    con = store.connect(s.db_path)
    store.init_schema(con)
    con.execute(
        "INSERT INTO records(id, source, sura, aya, text_display, text_index, page, juz, prev_id, next_id, metadata) "
        "VALUES ('quran:2:191','quran',2,191,'نص 191','text 191',1,1,NULL,NULL,'{}')"
    )
    con.execute(
        "INSERT INTO translations(record_id, translator_id, language, text_display, text_index) "
        "VALUES ('quran:2:191','fa.makarem','fa','ترجمه 191','tr 191')"
    )
    con.commit()
    con.close()
    monkeypatch.setattr(judge, "_PRICING_CACHE", {"test-model": (0.0, 0.0)})
    monkeypatch.setattr(judge.time, "sleep", lambda _s: None)
    return s


def _cand():
    return Candidate(
        id="quran:2:191", ids=["quran:2:191"], sura=2, aya_start=191, aya_end=191, score=0.5,
        text_display="نص 191", text_index="text 191", translation_fa="ترجمه 191",
        address="البقرة (2:191)", metadata={},
    )


def _ok_response():
    return httpx.Response(
        200,
        json={"choices": [{"message": {"content": CONTENT}}], "usage": {"prompt_tokens": 10, "completion_tokens": 5}},
    )


def _patch_post(monkeypatch, responses):
    calls = []

    def fake_post(*args, **kwargs):
        calls.append(kwargs.get("json"))
        return responses.pop(0)

    monkeypatch.setattr(judge.httpx, "post", fake_post)
    return calls


def test_retry_on_429_then_success(tmp_path, monkeypatch):
    s = _setup(tmp_path, monkeypatch)
    calls = _patch_post(monkeypatch, [httpx.Response(429, headers={"retry-after": "0"}), _ok_response()])
    out = judge.call_judge(s, "گزاره", [_cand()], model="test-model")
    assert len(calls) == 2
    assert out[0]["label"] == "Direct_Match"
    assert out[0]["reason"] == "دلیل"


def test_wait_cap_raises_readable_error(tmp_path, monkeypatch):
    s = _setup(tmp_path, monkeypatch)
    calls = _patch_post(monkeypatch, [httpx.Response(429, headers={"retry-after": "30"})] * 5)
    with pytest.raises(RuntimeError, match="سقف انتظار"):
        judge.call_judge(s, "گزاره", [_cand()], model="test-model")
    assert len(calls) == 2


def test_http_error_includes_provider_message(tmp_path, monkeypatch):
    s = _setup(tmp_path, monkeypatch)
    _patch_post(monkeypatch, [httpx.Response(403, json={"error": {"message": "daily quota exceeded"}})])
    with pytest.raises(RuntimeError, match="HTTP 403.*daily quota exceeded"):
        judge.call_judge(s, "گزاره", [_cand()], model="test-model")


def test_unparseable_responses_return_empty(tmp_path, monkeypatch):
    s = _setup(tmp_path, monkeypatch)
    bad = httpx.Response(200, json={"choices": [{"message": {"content": "not json"}}], "usage": {}})
    calls = _patch_post(monkeypatch, [bad] * 5)
    assert judge.call_judge(s, "گزاره", [_cand()], model="test-model") == []
    assert len(calls) == 5


def test_budget_guard_blocks_before_network(tmp_path, monkeypatch):
    s = _setup(tmp_path, monkeypatch)
    monkeypatch.setattr(judge, "_PRICING_CACHE", {"test-model": (1e-6, 2e-6)})
    monkeypatch.setattr(s, "budget_cap_usd", 0.0)
    calls = _patch_post(monkeypatch, [_ok_response()])
    with pytest.raises(judge.BudgetError):
        judge.call_judge(s, "گزاره", [_cand()], model="test-model")
    assert calls == []