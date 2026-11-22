import asyncio
import json
import logging
import threading

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from islamic_rag.agent import run_agent
from islamic_rag.llm import OpenAICompatClient, redact_secrets, resolve_provider
from islamic_rag.llm.providers import PROVIDERS
from islamic_rag.session import store as ss
from islamic_rag.sources import default_registry
from web.runtime import INFER_LOCK, settings

router = APIRouter(prefix="/api/agent", tags=["agent"])
_registry = default_registry()
_log = logging.getLogger("islamic_rag.agent")


class AgentChatBody(BaseModel):
    message: str
    session_id: str | None = None
    sources: list[str] | None = None
    provider: str | None = None
    model: str | None = None


def _sse(name: str, data: dict) -> str:
    return f"event: {name}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.get("/providers")
def providers():
    return {
        "providers": [
            {
                "id": p.id,
                "label": p.label,
                "default_model": p.default_model,
                "models": list(p.models),
            }
            for p in PROVIDERS.values()
        ]
    }


_RECOMMENDED_HINTS = (
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gpt-4o",
    "claude-3",
    "deepseek-chat",
)


def _context_label(value) -> str | None:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    if n <= 0:
        return None
    if n >= 1_000_000:
        return f"{n / 1_000_000:g}M"
    return f"{round(n / 1000)}K"


def _normalize_models(provider_id: str, raw: list[dict]) -> list[dict]:
    out: list[dict] = []
    for item in raw:
        mid = item.get("id")
        if not mid:
            continue
        mid = str(mid)
        if provider_id == "google" and mid.startswith("models/"):
            mid = mid[len("models/") :]
        pricing = item.get("pricing") or {}
        ctx = (
            item.get("context_length")
            or item.get("max_context_length")
            or item.get("context_window")
        )
        out.append(
            {
                "id": mid,
                "name": str(item.get("name") or item.get("display_name") or mid),
                "provider": provider_id,
                "contextLength": _context_label(ctx),
                "isFree": mid.endswith(":free") or str(pricing.get("prompt", "")) == "0",
                "recommended": any(h in mid for h in _RECOMMENDED_HINTS),
            }
        )
    out.sort(key=lambda m: (not m["recommended"], m["name"].lower()))
    return out


@router.get("/models")
def models(request: Request, provider: str | None = None):
    key = request.headers.get("X-LLM-Key", "").strip()
    if not key:
        return JSONResponse(
            {"status": "error", "code": "missing_key", "message": "کلید API وارد نشده است."},
            status_code=400,
        )
    prov = resolve_provider(provider)
    try:
        client = OpenAICompatClient(key, prov.base_url, prov.default_model)
        raw = client.list_models()
    except ValueError as exc:
        return JSONResponse({"status": "error", "message": str(exc)}, status_code=400)
    except RuntimeError as exc:
        return JSONResponse(
            {"status": "error", "message": redact_secrets(str(exc), key)}, status_code=502
        )
    return {
        "provider": prov.id,
        "default_model": prov.default_model,
        "models": _normalize_models(prov.id, raw),
    }


@router.get("/sessions")
def sessions():
    con = ss.connect_sessions(settings.sessions_db_path)
    try:
        return {"sessions": ss.list_sessions(con)}
    finally:
        con.close()


@router.get("/sessions/{session_id}")
def session_detail(session_id: str):
    con = ss.connect_sessions(settings.sessions_db_path)
    try:
        sess = ss.get_session(con, session_id)
        if sess is None:
            return JSONResponse({"status": "error", "message": "گفت‌وگو یافت نشد."}, status_code=404)
        return {"session": sess, "messages": ss.get_messages(con, session_id)}
    finally:
        con.close()


@router.delete("/sessions/{session_id}")
def session_delete(session_id: str):
    con = ss.connect_sessions(settings.sessions_db_path)
    try:
        ss.delete_session(con, session_id)
        return {"status": "ok"}
    finally:
        con.close()


@router.post("/chat")
async def chat(body: AgentChatBody, request: Request):
    text = body.message.strip()
    key = request.headers.get("X-LLM-Key", "").strip()
    if not text:
        return JSONResponse({"status": "error", "message": "گزاره خالی است."}, status_code=400)
    if len(text) > 5000:
        return JSONResponse(
            {"status": "error", "message": "گزاره بسیار طولانی است (حداکثر ۵۰۰۰ نویسه)."},
            status_code=400,
        )
    if not key:
        return JSONResponse(
            {"status": "error", "code": "missing_key", "message": "کلید API وارد نشده است."},
            status_code=400,
        )
    provider = resolve_provider(body.provider)
    model = body.model or provider.default_model
    try:
        client = OpenAICompatClient(key, provider.base_url, model)
    except ValueError as exc:
        return JSONResponse({"status": "error", "message": str(exc)}, status_code=400)

    con = ss.connect_sessions(settings.sessions_db_path)
    session_id = body.session_id
    if not session_id or ss.get_session(con, session_id) is None:
        session_id = ss.create_session(con, text[:60])
    ss.add_message(con, session_id, "user", content=text)
    history = [
        {"role": m["role"], "content": m["content"]}
        for m in ss.get_messages(con, session_id)[:-1]
    ]
    con.close()

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()
    cancel = threading.Event()
    sentinel = object()

    def emit(name: str, data: dict) -> None:
        if loop.is_closed():
            return
        try:
            loop.call_soon_threadsafe(queue.put_nowait, (name, data))
        except RuntimeError:
            pass

    def work() -> None:
        try:
            with INFER_LOCK:
                result = run_agent(
                    settings, _registry, client, text,
                    sources=body.sources,
                    emit=emit, history=history, cancel_event=cancel,
                )
            con2 = ss.connect_sessions(settings.sessions_db_path)
            try:
                mid = ss.add_message(
                    con2, session_id, "assistant",
                    content=result["answer"], evidence=result["evidence"], meta=result["meta"],
                )
            finally:
                con2.close()
            emit(
                "done",
                {
                    "message_id": mid,
                    "latency_s": result["meta"]["latency_s"],
                    "hops_used": result["meta"]["hops_used"],
                },
            )
        except Exception as exc:  # noqa: BLE001 — any failure becomes an SSE error event
            _log.exception("agent run failed")
            emit(
                "error",
                {
                    "code": "agent_error",
                    "message": "خطا در پردازش پژوهش؛ کلید، مدل یا اتصال را بررسی کنید.",
                    "detail": redact_secrets(type(exc).__name__, key),
                },
            )
        finally:
            if not loop.is_closed():
                try:
                    loop.call_soon_threadsafe(queue.put_nowait, sentinel)
                except RuntimeError:
                    pass

    async def gen():
        yield _sse("session", {"session_id": session_id})
        loop.run_in_executor(None, work)
        try:
            while True:
                item = await queue.get()
                if item is sentinel:
                    break
                name, data = item
                yield _sse(name, data)
        finally:
            cancel.set()

    return StreamingResponse(gen(), media_type="text/event-stream")