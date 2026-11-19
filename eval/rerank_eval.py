"""Offline comparison: RRF-only retrieval vs cross-encoder reranking on the gold set.

Run after the reranker weights are fully downloaded:
    uv run python eval/rerank_eval.py
    uv run python eval/rerank_eval.py --pool 80 --out eval/rerank_report_pool80.json
Reports real measured Recall@3/@10/@15, MRR, Success@5/@15 and latency for both modes.
Writes eval/rerank_report.json with the measured numbers.
"""

import argparse
import json
import time
from pathlib import Path

from run import load_gold, retrieval_metrics

from islamic_rag.rerank import reranker_available
from islamic_rag.settings import Settings


def measure(settings: Settings, gold: list[dict], k: int = 15) -> dict:
    t0 = time.perf_counter()
    m = retrieval_metrics(settings, gold, k=k)
    m["total_s"] = round(time.perf_counter() - t0, 1)
    m["avg_query_s"] = round(m["total_s"] / len(gold), 2)
    return m


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pool", type=int, default=None, help="override rerank_pool for this experiment")
    ap.add_argument("--out", type=Path, default=None, help="report path (default: eval/rerank_report.json)")
    args = ap.parse_args()

    settings = Settings()
    if args.pool is not None:
        settings.rerank_pool = args.pool
    gold = load_gold()
    if not reranker_available(settings):
        print("reranker weights not complete yet; aborting (download still running).")
        return

    settings.use_reranker = False
    base = measure(settings, gold)
    settings.use_reranker = True
    rer = measure(settings, gold)

    keys = ["recall@3", "recall@10", "recall@15", "mrr", "success@5", "success@15"]
    print(f"{'metric':14s} {'RRF-only':>10s} {'reranker':>10s} {'delta':>8s}")
    for kk in keys:
        b, r = base.get(kk, 0), rer.get(kk, 0)
        print(f"{kk:14s} {b:10.4f} {r:10.4f} {r - b:+8.4f}")
    print(f"{'avg_query_s':14s} {base['avg_query_s']:10.2f} {rer['avg_query_s']:10.2f}")
    print(f"\nRRF misses: {len(base['misses'])}  reranker misses: {len(rer['misses'])}")
    base_ids = {m['id'] for m in base['misses']}
    rer_ids = {m['id'] for m in rer['misses']}
    recovered = sorted(base_ids - rer_ids)
    newly_lost = sorted(rer_ids - base_ids)
    print("recovered by reranker:", recovered)
    print("newly lost:", newly_lost)

    report = {
        "reranker_model": settings.reranker_model,
        "rerank_pool": settings.rerank_pool,
        "reranker_max_length": settings.reranker_max_length,
        "n": len(gold),
        "k": 15,
        "rrf_only": {k: base[k] for k in keys} | {"avg_query_s": base["avg_query_s"], "misses": len(base["misses"])},
        "reranker": {k: rer[k] for k in keys} | {"avg_query_s": rer["avg_query_s"], "misses": len(rer["misses"])},
        "recovered": recovered,
        "newly_lost": newly_lost,
        "reranker_misses": rer["misses"],
    }
    out = args.out or Path(__file__).resolve().parent / "rerank_report.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nwrote {out}")


if __name__ == "__main__":
    main()