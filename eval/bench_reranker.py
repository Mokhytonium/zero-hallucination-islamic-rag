"""Benchmark cross-encoder throughput on a real retrieval pool (CPU).

Thread count is machine-dependent: torch's default targets physical cores, while
forcing os.cpu_count() (logical) can oversubscribe. A single ordered pass is not
trustworthy -- first-run warmup and load drift confound it -- so configs are warmed
up and measured in forward/reverse rounds, reporting the median.
Any configuration change must leave the ranking identical, so top-15 ids are
compared against the first measured configuration.
"""

import argparse
import json
import os
import time
from pathlib import Path
from unittest.mock import patch

import torch

from islamic_rag import retrieve
from islamic_rag.rerank import _passage, get_reranker
from islamic_rag.settings import settings


def _pool(statement: str):
    captured = {}

    def capture(_settings, query, cands):
        captured["query"] = query
        captured["cands"] = cands
        return cands

    with patch("islamic_rag.rerank.rerank_candidates", capture):
        retrieve.hybrid_candidates(settings, statement)
    return captured["query"], captured["cands"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--gold-index", type=int, default=34)
    ap.add_argument("--out", type=Path, default=Path("eval/reranker_bench.json"))
    args = ap.parse_args()

    lines = Path("eval/gold_quran.jsonl").read_text(encoding="utf-8").splitlines()
    gold = [json.loads(line) for line in lines if line.strip()]
    query, cands = _pool(gold[args.gold_index]["statement"])
    pairs = [(query, _passage(c)) for c in cands]
    model = get_reranker(settings)
    default_threads = torch.get_num_threads()

    lengths = [len(model.tokenizer(q + " " + p)["input_ids"]) for q, p in pairs]
    report = {
        "statement": gold[args.gold_index]["statement"],
        "pairs": len(pairs),
        "token_len_min": min(lengths),
        "token_len_median": sorted(lengths)[len(lengths) // 2],
        "token_len_max": max(lengths),
        "logical_cpus": os.cpu_count(),
        "torch_default_threads": default_threads,
        "configs": {},
    }

    grid = [(default_threads, 16), (os.cpu_count() or default_threads, 16), (default_threads, 32), (2, 16)]
    grid = list(dict.fromkeys(grid))
    baseline = None
    # Warm up, then interleave forward/reverse rounds: a single ordered pass confounds
    # thread count with first-run allocation/cache warmup and with machine load drift.
    model.predict(pairs[:8], batch_size=8, show_progress_bar=False, convert_to_numpy=True)
    rounds = {}
    for rnd, order in enumerate([grid, list(reversed(grid))], start=1):
        for threads, batch in order:
            torch.set_num_threads(threads)
            t0 = time.perf_counter()
            scores = model.predict(pairs, batch_size=batch, show_progress_bar=False, convert_to_numpy=True)
            elapsed = time.perf_counter() - t0
            key = f"threads{threads}_batch{batch}"
            order_ids = sorted(range(len(scores)), key=lambda i: -float(scores[i]))
            top15 = [cands[i].id for i in order_ids[:15]]
            baseline = baseline if baseline is not None else top15
            rounds.setdefault(key, []).append(round(elapsed, 2))
            report["configs"][key] = {
                "seconds_per_round": rounds[key],
                "seconds_median": round(sorted(rounds[key])[len(rounds[key]) // 2], 2),
                "top15": top15,
                "same_top15_as_default": top15 == baseline,
                "saturated_scores": int(sum(1 for s in scores if float(s) in (0.0, 1.0))),
            }

    torch.set_num_threads(default_threads)
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()