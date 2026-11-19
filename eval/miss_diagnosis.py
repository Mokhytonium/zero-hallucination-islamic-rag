"""Diagnose the remaining retrieval misses: ranking depth vs reranker scoring.

Phase 1 (cheap, no reranker): for each miss, report the RRF rank of every relevant
verse inside the full fusion pool. A rank beyond `rerank_pool` means a deeper pool
could help; a rank inside it means the cross-encoder itself failed to lift it.

Phase 2 (--rerank): rerank the full pool for those queries and report whether the
relevant verses reach top-k. This is the experiment that decides whether increasing
`rerank_pool` is worth its latency cost.

    uv run python eval/miss_diagnosis.py
    uv run python eval/miss_diagnosis.py --rerank
"""

import argparse
import json
from pathlib import Path
from unittest.mock import patch

from islamic_rag import retrieve
from islamic_rag.rerank import reranker_available
from islamic_rag.settings import Settings


def _pool_order(settings: Settings, statement: str, depth: int) -> list[str]:
    captured: dict = {}

    def fake_merge(con, ids, scores, s):
        captured["ids"] = list(ids)
        return []

    original = settings.rerank_pool
    settings.rerank_pool = depth
    try:
        with patch.object(retrieve, "_merge_and_build", fake_merge):
            retrieve.hybrid_candidates(settings, statement)
    finally:
        settings.rerank_pool = original
    return captured.get("ids", [])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rerank", action="store_true", help="also run the cross-encoder on the full pool")
    ap.add_argument("--depth", type=int, default=150)
    ap.add_argument("--out", type=Path, default=Path("eval/miss_diagnosis.json"))
    args = ap.parse_args()

    settings = Settings()
    report_path = Path("eval/rerank_report.json")
    misses = json.loads(report_path.read_text(encoding="utf-8"))["reranker_misses"]
    gold = {
        g["id"]: g
        for g in (
            json.loads(line)
            for line in Path("eval/gold_quran.jsonl").read_text(encoding="utf-8").splitlines()
            if line.strip()
        )
    }

    rows = []
    for m in misses:
        stmt = m["statement"]
        order = _pool_order(settings, stmt, args.depth)
        ranks = {rid: (order.index(rid) + 1 if rid in order else None) for rid in m["relevant"]}
        row = {
            "id": m["id"],
            "statement": stmt,
            "category": gold[m["id"]]["category"],
            "pool_size": len(order),
            "rrf_ranks": ranks,
            "beyond_default_pool": any(
                r is None or r > settings.rerank_pool for r in ranks.values()
            ),
        }
        rows.append(row)
        print(f"id{m['id']:>3} pool={len(order):>3} ranks={ranks}", flush=True)

    if args.rerank:
        if not reranker_available(settings):
            print("reranker weights incomplete; skipping phase 2")
        else:
            settings.rerank_pool = args.depth
            for row in rows:
                cands = retrieve.hybrid_candidates(settings, row["statement"], k=settings.top_k)
                got = {c.id for c in cands}
                hit = [rid for rid in row["rrf_ranks"] if rid in got]
                row["deep_pool_recovered"] = bool(hit)
                row["deep_pool_hits"] = hit
                print(f"id{row['id']:>3} deep-pool top{settings.top_k} hits={hit}", flush=True)

    args.out.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nwrote {args.out}")


if __name__ == "__main__":
    main()