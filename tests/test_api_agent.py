import pytest
from fastapi.testclient import TestClient

import web.app as webapp
from web import api_agent

KEY = "sk-test-abcdef0123456789abcdef"


def fake_run_agent(settings, registry, client, message, **kw):
    emit = kw["emit"]
    emit("thinking_step", {"hop": 1, "phase": "planning", "title": "تجزیه"})
    emit("evidence_payload", {"doc_id": "quran:2:255", "text_display": "نص", "tier": 1})
    emit("text_delta", {"delta": "پاسخ "})
    emit("text_delta", {"delta": "[[REF:quran:2:255]]"})
    return {
        "answer": "پاسخ [[REF:quran:2:255]]",
        "evidence": [{"doc_id": "quran:2:255"}],
        "meta": {"hops_used": 1, "latency_s": 0.2},
    }


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(webapp, "_warmup", lambda: None)
    monkeypatch.setattr(api_agent, "run_agent", fake_run_agent)
    monkeypatch.setattr(api_agent.settings, "data_dir", tmp_path)
    with TestClient(webapp.app) as c:
        yield c


def _stream(client, json, headers=None):
    with client.stream("POST", "/api/agent/chat", json=json, headers=headers or {}) as r:
        return r.status_code, "".join(r.iter_text())


def test_chat_streams_full_event_contract(client):
    status, body = _stream(client, {"message": "صبر"}, {"X-LLM-Key": KEY})
    assert status == 200
    for name in ("session", "thinking_step", "evidence_payload", "text_delta", "done"):
        assert f"event: {name}" in body
    assert KEY not in body


def test_missing_key_rejected(client):
    r = client.post("/api/agent/chat", json={"message": "صبر"})
    assert r.status_code == 400
    assert r.json()["code"] == "missing_key"


def test_empty_message_rejected(client):
    r = client.post("/api/agent/chat", json={"message": "  "}, headers={"X-LLM-Key": KEY})
    assert r.status_code == 400


def test_session_persisted_and_listed(client):
    _stream(client, {"message": "صبر فضیلت است"}, {"X-LLM-Key": KEY})
    sessions = client.get("/api/agent/sessions").json()["sessions"]
    assert len(sessions) == 1
    sid = sessions[0]["id"]
    detail = client.get(f"/api/agent/sessions/{sid}").json()
    roles = [m["role"] for m in detail["messages"]]
    assert roles == ["user", "assistant"]
    assert detail["messages"][1]["evidence"][0]["doc_id"] == "quran:2:255"


def test_delete_session(client):
    _stream(client, {"message": "صبر"}, {"X-LLM-Key": KEY})
    sid = client.get("/api/agent/sessions").json()["sessions"][0]["id"]
    assert client.delete(f"/api/agent/sessions/{sid}").json()["status"] == "ok"
    assert client.get("/api/agent/sessions").json()["sessions"] == []


def test_error_event_redacts_key(client, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError(f"provider rejected {KEY}")

    monkeypatch.setattr(api_agent, "run_agent", boom)
    status, body = _stream(client, {"message": "صبر"}, {"X-LLM-Key": KEY})
    assert status == 200
    assert "event: error" in body
    assert KEY not in body


def test_providers_endpoint(client):
    data = client.get("/api/agent/providers").json()
    ids = {p["id"] for p in data["providers"]}
    assert {"openrouter", "google", "openai"} <= ids


def test_deep_research_flag_forwarded(client, monkeypatch):
    captured = {}

    def spy(settings, registry, client_, message, **kw):
        captured["deep_research"] = kw.get("deep_research")
        return fake_run_agent(settings, registry, client_, message, **kw)

    monkeypatch.setattr(api_agent, "run_agent", spy)
    _stream(client, {"message": "صبر", "deep_research": True}, {"X-LLM-Key": KEY})
    assert captured["deep_research"] is True