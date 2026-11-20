import hashlib
import json
import logging
import time

from . import PIPELINE_VERSION, store
from .judge import APPROVED, SYSTEM_PROMPT, call_judge
from .normalize import normalize
from .rerank import reranker_available
from .retrieve import Candidate, hybrid_candidates
from .settings import Settings

_SECTION_OF = {
    "Direct_Match": "main",
    "Conditional_Match": "supporting",
    "Contradiction": "opposing",
    "Unverified": "unverified",
}


def _verse_view(con, rid: str, settings: Settings) -> dict | None:
    if not rid:
        return None
    r = store.get_records(con, [rid]).get(rid)
    if r is None:
        return None
    tr = store.get_translation(con, rid, settings.primary_translation)
    meta = json.loads(r["metadata"])
    return {
        "id": rid,
        "address": f"{meta.get('surah_name', '')} ({r['sura']}:{r['aya']})",
        "text_display": r["text_display"],
        "translation_fa": tr["text_display"] if tr else "",
    }


def _hydrate(con, cand: Candidate, label: str, settings: Settings, reason: str = "") -> dict:
    records = store.get_records(con, cand.ids)
    display_parts = []
    tr_parts = []
    for rid in cand.ids:
        r = records[rid]
        display_parts.append(r["text_display"])
        tr = store.get_translation(con, rid, settings.primary_translation)
        if tr:
            tr_parts.append(tr["text_display"])
    first = records[cand.ids[0]]
    last = records[cand.ids[-1]]
    return {
        "id": cand.id,
        "ids": cand.ids,
        "address": cand.address,
        "surah_name": cand.metadata.get("surah_name", ""),
        "sura": cand.sura,
        "aya_start": cand.aya_start,
        "aya_end": cand.aya_end,
        "label": label,
        "reason": reason,
        "score": round(cand.score, 4),
        "rrf_score": round(cand.rrf_score, 5),
        "rerank_score": round(cand.rerank_score, 4) if cand.rerank_score is not None else None,
        "signals": cand.signals,
        "text_display": " ".join(display_parts),
        "translation_fa": " ".join(tr_parts),
        "revelation_place": cand.metadata.get("revelation_place"),
        "page": first["page"],
        "juz": first["juz"],
        "context": {
            "before": _verse_view(con, first["prev_id"], settings),
            "after": _verse_view(con, last["next_id"], settings),
        },
    }


def _config_signature(settings: Settings) -> str:
    cfg = {
        "top_k": settings.top_k,
        "retrieval_pool": settings.retrieval_pool,
        "max_candidates": settings.max_candidates_per_source,
        "translation": settings.primary_translation,
        "rerank_active": settings.use_reranker and reranker_available(settings),
        "reranker": settings.reranker_model,
        "rerank_pool": settings.rerank_pool,
        "rerank_max_length": settings.reranker_max_length,
        # Prompt tuning must not serve verdicts cached under the old prompt.
        "judge_prompt": hashlib.sha256(SYSTEM_PROMPT.encode("utf-8")).hexdigest()[:8],
    }
    blob = json.dumps(cfg, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:12]


def retrieve_stage(settings: Settings, statement: str) -> tuple[list[Candidate], float]:
    t = time.perf_counter()
    candidates = hybrid_candidates(settings, statement, k=settings.top_k)
    return candidates, time.perf_counter() - t


def judge_stage(
    settings: Settings,
    statement: str,
    judged: list[Candidate],
    use_judge: bool,
    judge_model: str,
    client=None,
    enforce_budget: bool = True,
) -> tuple[dict, dict, str | None, bool, float]:
    reasons: dict[str, str] = {}
    labels: dict[str, str] = {}
    judge_error: str | None = None
    judge_partial = False
    judge_s = 0.0
    if use_judge:
        t_j = time.perf_counter()
        try:
            verdicts = call_judge(
                settings, statement, judged, model=judge_model,
                client=client, enforce_budget=enforce_budget,
            )
        except Exception as exc:
            verdicts = []
            judge_error = f"{type(exc).__name__}: {exc}"
            logging.getLogger("islamic_rag.pipeline").warning("judge failed", exc_info=True)
        judge_s = time.perf_counter() - t_j
        if not verdicts and judge_error is None:
            judge_error = "داور پاسخ قابل‌اتکا برنگرداند (پاسخ خالی یا خارج از فهرست کاندیدها)."
        labels = {v["id"]: v["label"] for v in verdicts if v["label"] in APPROVED}
        reasons = {v["id"]: v.get("reason", "") for v in verdicts}
        if judge_error is None:
            seen = {v["id"] for v in verdicts}
            missing = [c for c in judged if c.id not in seen]
            if missing:
                judge_partial = True
                for c in missing:
                    labels[c.id] = "Unverified"
                judge_error = (
                    f"داور برای {len(missing)} کاندید حکمی صادر نکرد؛ "
                    "آن‌ها با برچسب Unverified نمایش داده می‌شوند."
                )
    if not use_judge or (judge_error is not None and not judge_partial):
        labels = {c.id: "Unverified" for c in judged}
    return labels, reasons, judge_error, judge_partial, judge_s


def hydrate_stage(
    con, judged: list[Candidate], labels: dict, reasons: dict, settings: Settings
) -> dict[str, list]:
    sections: dict[str, list] = {"main": [], "supporting": [], "opposing": [], "unverified": []}
    for cand in judged:
        label = labels.get(cand.id)
        if label is None:
            continue
        sections[_SECTION_OF[label]].append(
            _hydrate(con, cand, label, settings, reasons.get(cand.id, ""))
        )
    return sections


def build_meta(
    settings: Settings,
    judged: list[Candidate],
    use_judge: bool,
    judge_model: str,
    judge_error: str | None,
    judge_partial: bool,
    retrieval_s: float,
    judge_s: float,
    t0: float,
) -> dict:
    return {
        "candidates_considered": len(judged),
        "judge_model": judge_model if use_judge and (judge_error is None or judge_partial) else None,
        "judge_error": judge_error,
        "embed_model": settings.embed_model,
        "reranker": (
            settings.reranker_model
            if settings.use_reranker and reranker_available(settings)
            else None
        ),
        "rerank_pool": settings.rerank_pool,
        "translation": settings.primary_translation,
        "latency_s": round(time.perf_counter() - t0, 2),
        "retrieval_s": round(retrieval_s, 2),
        "judge_s": round(judge_s, 2),
    }


def answer(
    settings: Settings,
    statement: str,
    use_judge: bool = True,
    judge_model: str | None = None,
    use_reranker: bool | None = None,
    client=None,
    enforce_budget: bool = True,
) -> dict:
    t0 = time.perf_counter()
    if use_reranker is not None and use_reranker != settings.use_reranker:
        settings = settings.model_copy(update={"use_reranker": use_reranker})
    judge_model = judge_model or settings.judge_model
    qn = normalize(statement)
    query_hash = hashlib.sha256(qn.encode("utf-8")).hexdigest()
    version_key = (
        f"{PIPELINE_VERSION}:{_config_signature(settings)}"
        + ("" if use_judge else ":nojudge"),
        settings.embed_model,
        judge_model,
    )

    con = store.connect(settings.db_path)
    cached = store.cache_get(con, query_hash, version_key)
    if cached:
        con.close()
        result = json.loads(cached)
        result["cached"] = True
        return result

    candidates, retrieval_s = retrieve_stage(settings, statement)
    if not candidates:
        result = {"status": "no_match", "statement": statement, "sections": {}}
        store.cache_set(con, query_hash, version_key, json.dumps(result, ensure_ascii=False))
        con.close()
        return result

    judged = candidates[: settings.max_candidates_per_source]
    labels, reasons, judge_error, judge_partial, judge_s = judge_stage(
        settings, statement, judged, use_judge, judge_model, client, enforce_budget
    )
    sections = hydrate_stage(con, judged, labels, reasons, settings)
    result = {
        "status": "ok",
        "statement": statement,
        "sections": sections,
        "meta": build_meta(
            settings, judged, use_judge, judge_model, judge_error, judge_partial,
            retrieval_s, judge_s, t0,
        ),
    }
    if judge_error is None:
        store.cache_set(con, query_hash, version_key, json.dumps(result, ensure_ascii=False))
    con.close()
    return result