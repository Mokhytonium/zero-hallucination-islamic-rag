import json
import logging
import re
import time

from .. import store
from ..judge import APPROVED, call_judge
from ..normalize import normalize
from ..rerank import rerank_candidates, reranker_available
from ..retrieve import Candidate, _merge_and_build
from ..settings import Settings
from ..sources.registry import SourceRegistry
from .prompts import (
    GAP_SYSTEM_PROMPT,
    PLANNER_SYSTEM_PROMPT,
    REASONER_SYSTEM_PROMPT,
    reasoner_user,
)
from .refs import chunk_text, clean_answer
from .tools import get_verse_context, retrieve_evidence
from .trace import (
    COST,
    EVIDENCE_PAYLOAD,
    REF_REJECTED,
    TEXT_DELTA,
    THINKING_STEP,
    Emit,
    thinking_step,
)

NO_EVIDENCE_MESSAGE = "هیچ آیه‌ی تأییدشده‌ای در پایگاه داده برای این گزاره یافت نشد."

_log = logging.getLogger("islamic_rag.agent")


def _json_parse(text: str) -> dict:
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", (text or "").strip())
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if not m:
            return {}
        try:
            data = json.loads(m.group(0))
        except json.JSONDecodeError:
            return {}
    return data if isinstance(data, dict) else {}


class _CostEmittingClient:
    """Delegates to the BYOK client and emits a cost event after every call."""

    def __init__(self, client, emit: Emit) -> None:
        self._client = client
        self._emit = emit

    @property
    def key(self):
        return self._client.key

    @property
    def model(self) -> str:
        return self._client.model

    def complete(self, messages, **kw):
        res = self._client.complete(messages, **kw)
        self._emit(
            COST,
            {
                "prompt_tokens": res.prompt_tokens,
                "completion_tokens": res.completion_tokens,
                "model": res.model,
            },
        )
        return res

    def stream(self, messages, **kw):
        yield from self._client.stream(messages, **kw)


def _pool_summaries(pool: dict[str, Candidate]) -> list[dict]:
    return [
        {"doc_id": c.id, "address": c.address, "translation_fa": c.translation_fa[:200]}
        for c in pool.values()
    ]


def run_agent(
    settings: Settings,
    registry: SourceRegistry,
    client,
    message: str,
    *,
    deep_research: bool = False,
    sources: list[str] | None = None,
    emit: Emit | None = None,
    history: list[dict] | None = None,
    cancel_event=None,
) -> dict:
    emit = emit or (lambda _n, _d: None)
    t0 = time.perf_counter()
    llm = _CostEmittingClient(client, emit)
    key = client.key.get_secret_value()
    pool: dict[str, Candidate] = {}
    hops_used = 1

    def cancelled() -> bool:
        return cancel_event is not None and cancel_event.is_set()

    def add_pool(cands: list[Candidate]) -> None:
        for c in cands:
            pool.setdefault(c.id, c)

    def llm_json(system: str, user: str) -> dict:
        res = llm.complete(
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            temperature=0,
            max_tokens=1200,
            response_format={"type": "json_object"},
        )
        return _json_parse(res.content)

    emit(THINKING_STEP, thinking_step(1, "planning", "تجزیه‌ی پرسش به زیرپرسش‌ها"))
    plan = llm_json(PLANNER_SYSTEM_PROMPT, message)
    plan_subs = plan.get("subqueries", [])
    subqueries = [sq["query"] for sq in plan_subs if sq.get("query")] or [message]

    if deep_research:
        emit(
            THINKING_STEP,
            thinking_step(1, "retrieval", "بازیابی شواهد گام ۱", queries=subqueries),
        )
        for q in subqueries:
            if cancelled():
                break
            add_pool(retrieve_evidence(settings, registry, q, sources=sources, light=True))

        hop = 1
        while hop < settings.agent_max_hops and not cancelled():
            gap_user = json.dumps(
                {"statement": message, "evidence": _pool_summaries(pool)}, ensure_ascii=False
            )
            gap = llm_json(GAP_SYSTEM_PROMPT, gap_user)
            next_queries = [q for q in gap.get("next_queries", []) if q]
            chain_ids = [d for d in gap.get("chain_doc_ids", []) if d]
            if not next_queries and not chain_ids:
                break
            hop += 1
            hops_used = hop
            emit(
                THINKING_STEP,
                thinking_step(
                    hop, "gap", "پرکردن شکاف منطقی و جست‌وجوی شاهد مخالف/مقیّد",
                    queries=next_queries,
                ),
            )
            for q in next_queries:
                if cancelled():
                    break
                add_pool(retrieve_evidence(settings, registry, q, sources=sources, light=True))
            if chain_ids:
                con = store.connect(settings.db_path)
                try:
                    for doc_id in chain_ids:
                        if cancelled():
                            break
                        if not registry.validate_ref(con, doc_id):
                            continue
                        emit(
                            THINKING_STEP,
                            thinking_step(hop, "chain", "زنجیره‌ی استناد", detail=doc_id),
                        )
                        if doc_id not in pool:
                            add_pool(_merge_and_build(con, [doc_id], {doc_id: 0.0}, settings))
                        get_verse_context(settings, registry, doc_id)
                finally:
                    con.close()
            if gap.get("done") and not next_queries:
                break
    else:
        # Fast path: one planner + one RRF retrieval + one judge + one reasoner.
        # No gap-loop and no reranker, to keep ordinary chat latency low.
        core = next(
            (sq["query"] for sq in plan_subs if sq.get("role") == "core" and sq.get("query")),
            subqueries[0],
        )
        emit(
            THINKING_STEP,
            thinking_step(1, "retrieval", "بازیابی سریع شواهد (بدون reranker)", queries=[core]),
        )
        if not cancelled():
            add_pool(retrieve_evidence(settings, registry, core, sources=sources, light=True))

    emit(
        THINKING_STEP,
        thinking_step(
            hops_used,
            "final",
            "داوری نهایی و آماده‌سازی شواهد" + (" (پژوهش عمیق)" if deep_research else ""),
        ),
    )
    candidates = list(pool.values())
    if deep_research and candidates and reranker_available(settings):
        candidates = rerank_candidates(settings, normalize(message), candidates)
    candidates = candidates[: settings.max_candidates_per_source]

    evidence: list[dict] = []
    verdicts: list[dict] = []
    if candidates and not cancelled():
        verdicts = call_judge(
            settings, message, candidates, client=llm, enforce_budget=False, purpose="agent_judge"
        )
        labels = {v["id"]: v["label"] for v in verdicts if v["label"] in APPROVED}
        reasons = {v["id"]: v.get("reason", "") for v in verdicts}
        con = store.connect(settings.db_path)
        try:
            for cand in candidates:
                label = labels.get(cand.id)
                if label is None:
                    continue
                payload = registry.hydrate(con, cand, label, settings, reasons.get(cand.id, ""))
                evidence.append(payload)
                emit(EVIDENCE_PAYLOAD, payload)
        finally:
            con.close()

    valid_ids = {e["doc_id"] for e in evidence}
    if not evidence and not cancelled():
        _log.warning(
            "agent empty evidence: model=%s candidates=%d verdicts=%d labels=%s",
            client.model,
            len(candidates),
            len(verdicts),
            [v.get("label") for v in verdicts],
        )
    answer_text = ""
    if not cancelled():
        if not evidence:
            # No approved verse => never let the Reasoner improvise from its own knowledge.
            answer_text = NO_EVIDENCE_MESSAGE
            emit(
                THINKING_STEP,
                thinking_step(hops_used, "final", "بدون شاهد تأییدشده", detail=answer_text),
            )
        else:
            res = llm.complete(
                [
                    {"role": "system", "content": REASONER_SYSTEM_PROMPT},
                    {"role": "user", "content": reasoner_user(message, evidence, history)},
                ],
                temperature=0,
                max_tokens=2500,
            )
            answer_text, rejected = clean_answer(res.content, valid_ids, key=key)
            for doc_id in rejected:
                emit(REF_REJECTED, {"doc_id": doc_id, "reason": "در فهرست شواهد تأییدشده نیست."})
        for chunk in chunk_text(answer_text):
            if cancelled():
                break
            emit(TEXT_DELTA, {"delta": chunk})

    return {
        "answer": answer_text,
        "evidence": evidence,
        "meta": {
            "hops_used": hops_used,
            "deep_research": deep_research,
            "candidates_considered": len(candidates),
            "latency_s": round(time.perf_counter() - t0, 2),
            "judge_model": client.model,
            "cancelled": cancelled(),
        },
    }