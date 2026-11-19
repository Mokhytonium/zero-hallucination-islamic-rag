from fastapi.testclient import TestClient

import web.app as webapp


def _client(monkeypatch):
    monkeypatch.setattr(webapp, "_warmup", lambda: None)
    return TestClient(webapp.app)


def test_empty_statement_rejected(monkeypatch):
    with _client(monkeypatch) as client:
        r = client.post("/api/search", json={"statement": "   ", "use_judge": False})
    assert r.status_code == 400
    assert r.json()["status"] == "error"


def test_too_long_statement_rejected(monkeypatch):
    with _client(monkeypatch) as client:
        r = client.post("/api/search", json={"statement": "ص" * 5001, "use_judge": False})
    assert r.status_code == 400
    assert r.json()["status"] == "error"


def test_paragraph_length_accepted_boundary(monkeypatch):
    monkeypatch.setattr(webapp, "answer", lambda *a, **k: {"status": "ok"})
    with _client(monkeypatch) as client:
        r = client.post("/api/search", json={"statement": "ص" * 5000, "use_judge": False})
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_internal_error_returns_safe_message(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("secret internal detail")

    monkeypatch.setattr(webapp, "answer", boom)
    with _client(monkeypatch) as client:
        r = client.post("/api/search", json={"statement": "صبر", "use_judge": False})
    assert r.status_code == 500
    body = r.json()
    assert body["status"] == "error"
    assert "secret" not in body["message"]


def test_status_endpoint_exposes_pipeline_config(monkeypatch):
    with _client(monkeypatch) as client:
        r = client.get("/api/status")
    assert r.status_code == 200
    d = r.json()
    assert isinstance(d["reranker_active"], bool)
    assert d["top_k"] > 0
    assert d["rerank_pool"] > 0
    assert d["judge_model"]
    assert d["translation"]