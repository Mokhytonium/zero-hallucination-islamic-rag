import httpx
import pytest

from islamic_rag.llm import client as client_mod
from islamic_rag.llm.client import OpenAICompatClient
from islamic_rag.llm.providers import resolve_provider

KEY = "sk-test-abcdef0123456789abcdef"


def _client():
    return OpenAICompatClient(KEY, "https://example.test/v1", "test-model")


def _ok():
    return httpx.Response(
        200,
        json={
            "model": "test-model",
            "choices": [{"message": {"content": "پاسخ"}}],
            "usage": {"prompt_tokens": 11, "completion_tokens": 7},
        },
    )


def test_requires_key():
    with pytest.raises(ValueError):
        OpenAICompatClient("", "https://example.test/v1", "m")


def test_complete_returns_content_and_usage(monkeypatch):
    monkeypatch.setattr(client_mod.time, "sleep", lambda _s: None)
    calls = []

    def fake_post(url, **kw):
        calls.append((url, kw))
        return _ok()

    monkeypatch.setattr(client_mod.httpx, "post", fake_post)
    res = _client().complete([{"role": "user", "content": "x"}])
    assert res.content == "پاسخ"
    assert res.prompt_tokens == 11 and res.completion_tokens == 7
    assert calls[0][1]["trust_env"] is False
    assert calls[0][1]["headers"]["Authorization"] == f"Bearer {KEY}"


def test_retry_on_429_then_success(monkeypatch):
    monkeypatch.setattr(client_mod.time, "sleep", lambda _s: None)
    responses = [httpx.Response(429, headers={"retry-after": "0"}), _ok()]
    monkeypatch.setattr(client_mod.httpx, "post", lambda *a, **k: responses.pop(0))
    assert _client().complete([{"role": "user", "content": "x"}]).content == "پاسخ"


def test_error_message_redacts_key(monkeypatch):
    monkeypatch.setattr(client_mod.time, "sleep", lambda _s: None)
    bad = httpx.Response(403, json={"error": {"message": f"invalid key {KEY}"}})
    monkeypatch.setattr(client_mod.httpx, "post", lambda *a, **k: bad)
    with pytest.raises(RuntimeError) as ei:
        _client().complete([{"role": "user", "content": "x"}])
    assert KEY not in str(ei.value)
    assert "HTTP 403" in str(ei.value)


class _FakeStreamResp:
    def __init__(self, lines, status=200):
        self._lines = lines
        self.status_code = status

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def iter_lines(self):
        return iter(self._lines)

    def read(self):
        pass


def test_stream_yields_deltas(monkeypatch):
    lines = [
        'data: {"choices":[{"delta":{"content":"سلام"}}]}',
        "",
        'data: {"choices":[{"delta":{"content":" دنیا"}}]}',
        "data: [DONE]",
    ]
    monkeypatch.setattr(
        client_mod.httpx, "stream", lambda *a, **k: _FakeStreamResp(lines)
    )
    out = list(_client().stream([{"role": "user", "content": "x"}]))
    assert out == ["سلام", " دنیا"]


def test_resolve_provider_defaults():
    assert resolve_provider(None).id == "openrouter"
    assert resolve_provider("google").base_url.endswith("/openai")
    assert resolve_provider("unknown").id == "openrouter"


def test_list_models_returns_catalogue(monkeypatch):
    payload = {"data": [{"id": "google/gemini-2.5-flash-lite"}, {"id": "openai/gpt-4o"}]}
    calls = []

    def fake_get(url, **kw):
        calls.append((url, kw))
        return httpx.Response(200, json=payload)

    monkeypatch.setattr(client_mod.httpx, "get", fake_get)
    models = _client().list_models()
    assert [m["id"] for m in models] == ["google/gemini-2.5-flash-lite", "openai/gpt-4o"]
    assert calls[0][0].endswith("/models")
    assert calls[0][1]["trust_env"] is False
    assert calls[0][1]["headers"]["Authorization"] == f"Bearer {KEY}"


def test_list_models_error_redacts_key(monkeypatch):
    bad = httpx.Response(401, json={"error": {"message": f"bad key {KEY}"}})
    monkeypatch.setattr(client_mod.httpx, "get", lambda *a, **k: bad)
    with pytest.raises(RuntimeError) as ei:
        _client().list_models()
    assert KEY not in str(ei.value)
    assert "HTTP 401" in str(ei.value)