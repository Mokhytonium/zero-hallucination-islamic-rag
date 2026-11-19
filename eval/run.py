import argparse
import hashlib
import json
import time
from datetime import UTC, datetime
from pathlib import Path

from islamic_rag import PIPELINE_VERSION, store
from islamic_rag.judge import SYSTEM_PROMPT, BudgetError, call_judge
from islamic_rag.pipeline import answer
from islamic_rag.rerank import reranker_available
from islamic_rag.retrieve import hybrid_candidates
from islamic_rag.settings import Settings

GOLD = Path(__file__).resolve().parent / "gold_quran.jsonl"

# Retrieval is deterministic but expensive with the CPU cross-encoder (~60s/query).
# The retrieval and judge phases ask for the same candidates, so compute them once.
_CAND_CACHE: dict[tuple, list] = {}


def candidates_for(settings: Settings, text: str, k: int) -> list:
    key = (
        text,
        k,
        settings.use_reranker,
        settings.rerank_pool,
        settings.retrieval_pool,
        settings.primary_translation,
    )
    if key not in _CAND_CACHE:
        _CAND_CACHE[key] = hybrid_candidates(settings, text, k=k)
    return _CAND_CACHE[key]


def load_gold() -> list[dict]:
    return [json.loads(line) for line in GOLD.read_text(encoding="utf-8").splitlines() if line.strip()]


def retrieval_metrics(settings: Settings, gold: list[dict], k: int = 10) -> dict:
    recalls3, recalls10, recallsk, mrrs, s5, sk = [], [], [], [], [], []
    misses = []
    for item in gold:
        cands = candidates_for(settings, item["statement"], k)
        rank_of: dict[str, int] = {}
        for rank, c in enumerate(cands):
            for rid in c.ids:
                rank_of.setdefault(rid, rank)
        rel = set(item["relevant_ids"])
        hit = rel & set(rank_of)
        recalls3.append(len({r for r in hit if rank_of[r] < 3}) / len(rel))
        recalls10.append(len({r for r in hit if rank_of[r] < 10}) / len(rel))
        recallsk.append(len({r for r in hit if rank_of[r] < k}) / len(rel))
        rr = 1.0 / (min(rank_of[r] for r in hit) + 1) if hit else 0.0
        mrrs.append(rr)
        s5.append(int(any(rank_of[r] < 5 for r in hit)))
        sk.append(int(bool(hit)))
        if not hit:
            misses.append({"id": item["id"], "statement": item["statement"], "relevant": sorted(rel)})
    n = len(gold)
    return {
        "n": n,
        "k": k,
        "recall@3": round(sum(recalls3) / n, 4),
        "recall@10": round(sum(recalls10) / n, 4),
        f"recall@{k}": round(sum(recallsk) / n, 4),
        "mrr": round(sum(mrrs) / n, 4),
        "success@5": round(sum(s5) / n, 4),
        f"success@{k}": round(sum(sk) / n, 4),
        "misses": misses,
    }


def judge_metrics(settings: Settings, gold: list[dict], model: str) -> dict:
    con = store.connect(settings.db_path)
    spent_before = store.total_cost(con)
    con.close()
    correct = 0
    retrieved_count = 0
    judged_count = 0
    false_approval = 0
    off_target_approvals = 0
    items_with_off_target = 0
    by_category: dict[str, list] = {}
    details = []
    latencies = []
    for item in gold:
        cands = candidates_for(settings, item["statement"], settings.top_k)[
            : settings.max_candidates_per_source
        ]
        rel = set(item["relevant_ids"])
        retrieved_rel = rel & {rid for c in cands for rid in c.ids}
        if not retrieved_rel:
            details.append({"id": item["id"], "status": "not_retrieved"})
            continue
        retrieved_count += 1
        t0 = time.time()
        try:
            verdicts = call_judge(settings, item["statement"], cands, model=model, purpose="eval")
        except BudgetError:
            print("[judge] budget cap reached; stopping judge eval", flush=True)
            break
        except Exception as exc:  # noqa: BLE001 - one API failure must not abort the whole eval
            details.append({"id": item["id"], "status": "judge_error", "error": str(exc)})
            print(f"[judge] id{item['id']:>2} ERROR {exc}", flush=True)
            continue
        latencies.append(time.time() - t0)
        time.sleep(5.0)
        if not verdicts:
            details.append({"id": item["id"], "status": "judge_error"})
            continue
        vmap = {v["id"]: v["label"] for v in verdicts}
        judged_count += 1
        label_by_rid = {}
        for c in cands:
            lab = vmap.get(c.id)
            for rid in c.ids:
                label_by_rid[rid] = lab
        expected = item["expected_label"]
        ok = any(label_by_rid.get(r) == expected for r in retrieved_rel)
        correct += int(ok)
        if expected in {"Context_Mismatch", "Superficial_Match"} and any(
            label_by_rid.get(r) in {"Direct_Match", "Conditional_Match"} for r in retrieved_rel
        ):
            false_approval += 1
        # Approvals on candidates outside the gold relevance set: what the researcher
        # sees as a wrong "main match" card. Gold lists are not exhaustive, so this is
        # an upper bound on false approvals, not a proven error count.
        off_target = [
            c.id
            for c in cands
            if not (set(c.ids) & rel) and vmap.get(c.id) in {"Direct_Match", "Conditional_Match"}
        ]
        off_target_approvals += len(off_target)
        items_with_off_target += int(bool(off_target))
        by_category.setdefault(item["category"], []).append(ok)
        details.append(
            {
                "id": item["id"],
                "expected": expected,
                "got": {r: label_by_rid.get(r) for r in sorted(retrieved_rel)},
                "ok": ok,
                "off_target_approvals": off_target,
            }
        )
        print(f"[judge] id{item['id']:>2} expected={expected} ok={ok}", flush=True)
    con = store.connect(settings.db_path)
    spent = store.total_cost(con)
    con.close()
    return {
        "model": model,
        "retrieved_items": retrieved_count,
        "judged_items": judged_count,
        "label_accuracy": round(correct / judged_count, 4) if judged_count else 0,
        "false_approvals_on_traps": false_approval,
        "off_target_approvals": off_target_approvals,
        "items_with_off_target_approval": items_with_off_target,
        "by_category": {k: round(sum(v) / len(v), 3) for k, v in by_category.items()},
        "avg_judge_latency_s": round(sum(latencies) / len(latencies), 2) if latencies else 0,
        "eval_cost_usd": round(spent - spent_before, 4),
        "total_spent_usd": round(spent, 4),
        "details": details,
    }


def byte_equality_check(settings: Settings, gold: list[dict]) -> dict:
    con = store.connect(settings.db_path)
    checked = 0
    mismatches = []
    for item in gold[:15]:
        res = answer(settings, item["statement"], use_judge=False)
        for sec in res.get("sections", {}).values():
            for it in sec:
                records = store.get_records(con, it["ids"])
                expected_text = " ".join(records[rid]["text_display"] for rid in it["ids"])
                tr_parts = []
                for rid in it["ids"]:
                    tr = store.get_translation(con, rid, settings.primary_translation)
                    if tr:
                        tr_parts.append(tr["text_display"])
                expected_tr = " ".join(tr_parts)
                checked += 1
                if expected_text != it["text_display"] or expected_tr != it["translation_fa"]:
                    mismatches.append(it["id"])
    con.close()
    return {"checked": checked, "mismatches": mismatches, "hallucination_rate": 0.0 if not mismatches else None}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--retrieval-only", action="store_true")
    parser.add_argument("--judge-model", default=None)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--out", default="eval/report.json")
    args = parser.parse_args()

    settings = Settings()
    gold = load_gold()
    if args.limit:
        gold = gold[: args.limit]

    model = args.judge_model or settings.judge_model
    report = {
        "meta": {
            "timestamp_utc": datetime.now(UTC).isoformat(timespec="seconds"),
            "pipeline_version": PIPELINE_VERSION,
            "judge_prompt_sha256_8": hashlib.sha256(SYSTEM_PROMPT.encode("utf-8")).hexdigest()[:8],
            "embed_model": settings.embed_model,
            "judge_model": model,
            "reranker": (
                settings.reranker_model
                if settings.use_reranker and reranker_available(settings)
                else None
            ),
            "rerank_pool": settings.rerank_pool,
            "retrieval_pool": settings.retrieval_pool,
            "top_k": settings.top_k,
            "max_candidates_per_source": settings.max_candidates_per_source,
            "translation": settings.primary_translation,
            "gold_items": len(gold),
        },
        "retrieval": retrieval_metrics(settings, gold, k=settings.top_k),
    }
    print(json.dumps(report["retrieval"], ensure_ascii=False, indent=2))
    if not args.retrieval_only:
        report["judge"] = judge_metrics(settings, gold, model)
        report["byte_equality"] = byte_equality_check(settings, gold)
        print(json.dumps({k: v for k, v in report["judge"].items() if k != "details"}, ensure_ascii=False, indent=2))
        print(json.dumps(report["byte_equality"], ensure_ascii=False, indent=2))
    Path(args.out).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"report written to {args.out}")


if __name__ == "__main__":
    main()