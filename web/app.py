import json
import logging
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from starlette.requests import Request

from islamic_rag import store
from islamic_rag.normalize import normalize
from islamic_rag.pipeline import answer
from islamic_rag.settings import ROOT
from web.api_agent import router as agent_router
from web.runtime import INFER_LOCK as _INFER_LOCK
from web.runtime import settings

WEB_DIR = Path(__file__).resolve().parent
EVAL_DIR = ROOT / "eval"
templates = Jinja2Templates(directory=str(WEB_DIR / "templates"))

_MEMORY_HINTS = ("1455", "pagefile", "memory", "allocate", "safetensors", "crossencoder")


def _warmup() -> None:
    try:
        from islamic_rag.embeddings import get_model

        get_model(settings.embed_model, settings)
        from islamic_rag.rerank import get_reranker, reranker_available

        if reranker_available(settings):
            get_reranker(settings)
    except Exception:
        logging.getLogger("islamic_rag.web").warning("model warmup failed", exc_info=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    threading.Thread(target=_warmup, daemon=True).start()
    yield


app = FastAPI(title="Zero-Hallucination Islamic RAG — Quran", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=str(WEB_DIR / "static")), name="static")
app.include_router(agent_router)


class SearchBody(BaseModel):
    statement: str
    use_judge: bool = True
    use_reranker: bool | None = None


@app.post("/api/search")
def search(body: SearchBody):
    text = body.statement.strip()
    if not text:
        return JSONResponse({"status": "error", "message": "گزاره خالی است."}, status_code=400)
    if len(text) > 5000:
        return JSONResponse(
            {"status": "error", "message": "گزاره بسیار طولانی است (حداکثر ۵۰۰۰ نویسه)."},
            status_code=400,
        )
    try:
        with _INFER_LOCK:
            result = answer(
                settings, text, use_judge=body.use_judge, use_reranker=body.use_reranker
            )
        return JSONResponse(result)
    except Exception as exc:
        logging.getLogger("islamic_rag.web").exception("search failed")
        low = f"{type(exc).__name__}: {exc}".lower()
        if body.use_reranker and any(h in low for h in _MEMORY_HINTS):
            return JSONResponse(
                {
                    "status": "error",
                    "code": "reranker_memory",
                    "message": "بارگذاری رتبه‌بند عصبی به دلیل کمبود حافظه ممکن نشد.",
                },
                status_code=503,
            )
        return JSONResponse(
            {"status": "error", "message": "خطای داخلی در پردازش گزاره."}, status_code=500
        )


@app.get("/api/status")
def status():
    from islamic_rag.rerank import reranker_available

    active = settings.use_reranker and reranker_available(settings)
    return {
        "reranker_active": active,
        "reranker_model": settings.reranker_model if active else None,
        "rerank_pool": settings.rerank_pool,
        "embed_model": settings.embed_model,
        "judge_model": settings.judge_model,
        "top_k": settings.top_k,
        "translation": settings.primary_translation,
    }


@app.get("/api/cost")
def cost():
    con = store.connect(settings.db_path)
    spent = store.total_cost(con)
    con.close()
    return {"spent_usd": round(spent, 4), "cap_usd": settings.budget_cap_usd}


@app.get("/api/translators")
def translators():
    con = store.connect(settings.db_path)
    rows = con.execute(
        "SELECT id, name FROM sources WHERE kind='translation' ORDER BY id"
    ).fetchall()
    con.close()
    ordered = sorted(rows, key=lambda r: r["id"] != settings.primary_translation)
    return {"translators": [{"id": r["id"], "name": r["name"]} for r in ordered]}


@app.get("/api/gold")
def gold():
    path = EVAL_DIR / "gold_quran.jsonl"
    items = []
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                d = json.loads(line)
            except json.JSONDecodeError:
                continue
            items.append(
                {
                    "id": d.get("id"),
                    "statement": d.get("statement", ""),
                    "category": d.get("category", ""),
                }
            )
    return {"items": items}


@app.get("/api/eval")
def evaluation():
    report_path = EVAL_DIR / "report.json"
    rerank_path = EVAL_DIR / "rerank_report_pool80.json"
    if not report_path.exists():
        return {"available": False}
    rep = json.loads(report_path.read_text(encoding="utf-8"))
    retr = rep.get("retrieval", {})
    judge = rep.get("judge", {})
    byte = rep.get("byte_equality", {})
    meta = rep.get("meta", {})
    out = {
        "available": True,
        "pipeline_version": meta.get("pipeline_version"),
        "timestamp_utc": meta.get("timestamp_utc"),
        "gold_items": meta.get("gold_items"),
        "judge_model": meta.get("judge_model"),
        "embed_model": meta.get("embed_model"),
        "reranker": meta.get("reranker"),
        "rerank_pool": meta.get("rerank_pool"),
        "hallucination_rate": byte.get("hallucination_rate"),
        "byte_checked": byte.get("checked"),
        "byte_mismatches": len(byte.get("mismatches", [])),
        "judge_accuracy": judge.get("label_accuracy"),
        "judged_items": judge.get("judged_items"),
        "false_approvals_on_traps": judge.get("false_approvals_on_traps"),
        "off_target_approvals": judge.get("off_target_approvals"),
        "items_with_off_target_approval": judge.get("items_with_off_target_approval"),
        "avg_judge_latency_s": judge.get("avg_judge_latency_s"),
        "recall_at_3": retr.get("recall@3"),
        "recall_at_10": retr.get("recall@10"),
        "recall_at_15": retr.get("recall@15"),
        "mrr": retr.get("mrr"),
        "success_at_15": retr.get("success@15"),
    }
    if rerank_path.exists():
        rr = json.loads(rerank_path.read_text(encoding="utf-8"))
        out["rerank"] = {
            "rrf_only": rr.get("rrf_only", {}),
            "reranker": rr.get("reranker", {}),
            "recovered": len(rr.get("recovered", [])),
            "newly_lost": len(rr.get("newly_lost", [])),
        }
    return out


def _translations_for(con, ids: list[str]) -> dict[str, str]:
    rows = con.execute(
        "SELECT id FROM sources WHERE kind='translation' ORDER BY id"
    ).fetchall()
    out: dict[str, str] = {}
    for t in rows:
        tid = t["id"]
        parts = []
        for rid in ids:
            tr = store.get_translation(con, rid, tid)
            if tr:
                parts.append(tr["text_display"])
        out[tid] = " ".join(parts)
    return out


def _verse_block(con, rid: str | None) -> dict | None:
    if not rid:
        return None
    r = store.get_records(con, [rid]).get(rid)
    if r is None:
        return None
    meta = json.loads(r["metadata"])
    return {
        "id": rid,
        "address": f"{meta.get('surah_name', '')} ({r['sura']}:{r['aya']})",
        "text_display": r["text_display"],
        "translations": _translations_for(con, [rid]),
    }


@app.get("/api/verse")
def verse(ids: str):
    id_list = [x.strip() for x in ids.split(",") if x.strip()]
    if not id_list:
        return JSONResponse({"status": "error", "message": "شناسه نامعتبر."}, status_code=400)
    con = store.connect(settings.db_path)
    records = store.get_records(con, id_list)
    present = [rid for rid in id_list if rid in records]
    if not present:
        con.close()
        return JSONResponse({"status": "error", "message": "آیه یافت نشد."}, status_code=404)
    first, last = records[present[0]], records[present[-1]]
    meta = json.loads(first["metadata"])
    text_display = " ".join(records[rid]["text_display"] for rid in present)
    text_index = " ".join(records[rid]["text_index"] for rid in present)
    words = [{"word": w} for w in text_index.split() if len(w) > 1]
    surah = con.execute("SELECT * FROM surahs WHERE id=?", (first["sura"],)).fetchone()
    result = {
        "id": present[0],
        "ids": present,
        "sura": first["sura"],
        "aya_start": first["aya"],
        "aya_end": last["aya"],
        "surah_name": meta.get("surah_name", ""),
        "surah_name_en": surah["name_en"] if surah else "",
        "revelation_place": meta.get("revelation_place"),
        "revelation_order": meta.get("revelation_order"),
        "ayah_count": surah["ayah_count"] if surah else None,
        "page": first["page"],
        "juz": first["juz"],
        "text_display": text_display,
        "words": words,
        "translations": _translations_for(con, present),
        "before": _verse_block(con, first["prev_id"]),
        "after": _verse_block(con, last["next_id"]),
    }
    con.close()
    return result


@app.get("/api/concordance")
def concordance(word: str):
    token = normalize(word).split(" ")[0] if normalize(word) else ""
    if len(token) < 2:
        return {"word": token, "count": 0, "samples": []}
    match = '"' + token.replace('"', "") + '"'
    con = store.connect(settings.db_path)
    count = con.execute(
        "SELECT COUNT(*) c FROM records_fts WHERE records_fts MATCH ?", (match,)
    ).fetchone()["c"]
    rows = con.execute(
        """
        SELECT r.id, r.sura, r.aya, r.metadata
        FROM records_fts JOIN records r ON r.rowid = records_fts.rowid
        WHERE records_fts MATCH ? LIMIT 6
        """,
        (match,),
    ).fetchall()
    con.close()
    samples = []
    for r in rows:
        meta = json.loads(r["metadata"])
        samples.append(
            {
                "id": r["id"],
                "address": f"{meta.get('surah_name', '')} ({r['sura']}:{r['aya']})",
            }
        )
    return {"word": token, "count": count, "samples": samples}


# Serve the built React workbench at / when present; otherwise fall back to the
# legacy template. All /api routes above are registered first and take precedence.
FRONTEND_DIST = WEB_DIR / "frontend" / "dist"
if FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")
else:
    @app.get("/", response_class=HTMLResponse)
    def index(request: Request):
        return templates.TemplateResponse(request, "index.html", {})