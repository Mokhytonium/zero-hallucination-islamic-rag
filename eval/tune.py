import json
from pathlib import Path

import numpy as np

from islamic_rag import store
from islamic_rag.embeddings import encode
from islamic_rag.normalize import normalize
from islamic_rag.retrieve import _fts_query, _matrix
from islamic_rag.settings import settings

GOLD = Path(__file__).resolve().parent / "gold_quran.jsonl"
MAXPOOL = 200


def build_lists():
    con = store.connect(settings.db_path)
    gold = [json.loads(x) for x in GOLD.read_text(encoding="utf-8").splitlines() if x.strip()]
    ar_ids, ar_mat = _matrix(con, settings.embed_model, "ar")
    fa_ids, fa_mat = _matrix(con, settings.embed_model, "fa")
    data = []
    for it in gold:
        qv = encode([normalize(it["statement"])], settings)[0]
        lists = {}
        for kind, ids, mat in (("ar", ar_ids, ar_mat), ("fa", fa_ids, fa_mat)):
            sims = mat @ qv
            order = np.argsort(-sims)[:MAXPOOL]
            lists["dense_" + kind] = [ids[i] for i in order]
        fq = _fts_query(it["statement"])
        lists["fts_rec"] = (
            [r["id"] for r in store.fts_search_records(con, fq, MAXPOOL)] if fq else []
        )
        tr_hits = store.fts_search_translations(con, fq, MAXPOOL * 4) if fq else []
        primary, seen_all = [], {}
        for r in tr_hits:
            if r["translator_id"] == settings.primary_translation and r["id"] not in primary:
                primary.append(r["id"])
            seen_all.setdefault(r["id"], len(seen_all))
        lists["fts_tr"] = primary[:MAXPOOL]
        lists["fts_tr_all"] = list(seen_all)[:MAXPOOL]
        data.append((it, lists))
    con.close()
    return data


def fuse(lists, weights, k, floor, topk=10, pool=MAXPOOL):
    scores = {}
    for name, lst in lists.items():
        w = weights.get(name, 0.0)
        if w == 0:
            continue
        for rank, rid in enumerate(lst[:pool]):
            scores[rid] = scores.get(rid, 0.0) + w / (k + rank)
    ranked = sorted(scores.items(), key=lambda x: -x[1])
    if not ranked:
        return []
    fl = ranked[0][1] * floor
    return [rid for rid, s in ranked if s >= fl][:topk]


def recall(data, weights, k, floor, pool=MAXPOOL, topk=10):
    r10, r3, mrr, s5, s10 = [], [], [], [], []
    for it, lists in data:
        kept = fuse(lists, weights, k, floor, topk=topk, pool=pool)
        rank_of = {}
        for rank, rid in enumerate(kept):
            rank_of.setdefault(rid, rank)
        rel = set(it["relevant_ids"])
        hit = rel & set(rank_of)
        r10.append(len(hit) / len(rel))
        r3.append(len({x for x in hit if rank_of[x] < 3}) / len(rel))
        mrr.append(1.0 / (min(rank_of[x] for x in hit) + 1) if hit else 0.0)
        s5.append(int(any(rank_of[x] < 5 for x in hit)))
        s10.append(int(bool(hit)))
    n = len(data)
    return (
        round(sum(r10) / n, 3),
        round(sum(r3) / n, 3),
        round(sum(mrr) / n, 3),
        round(sum(s5) / n, 3),
        round(sum(s10) / n, 3),
    )


def ceiling(data, pool):
    vals = []
    for it, lists in data:
        union = set().union(*[set(v[:pool]) for v in lists.values()])
        rel = set(it["relevant_ids"])
        vals.append(len(rel & union) / len(rel))
    return round(sum(vals) / len(vals), 3)


def best_rank(it, lists, pool):
    rel = set(it["relevant_ids"])
    out = {}
    for name, lst in lists.items():
        ranks = [i for i, rid in enumerate(lst[:pool]) if rid in rel]
        out[name] = min(ranks) if ranks else None
    return out


if __name__ == "__main__":
    data = build_lists()
    for p in (60, 100, 150, 200):
        print(f"union recall ceiling (pool={p}): {ceiling(data, p):.3f}")
    base = {"dense_ar": 1, "dense_fa": 1, "fts_rec": 1, "fts_tr": 1}
    fa2 = {"dense_ar": 1, "dense_fa": 2, "fts_rec": 0, "fts_tr": 2}
    fa2all = {"dense_ar": 1, "dense_fa": 2, "fts_rec": 0, "fts_tr_all": 2}
    faonly = {"dense_fa": 2, "fts_tr": 2}
    faonlyall = {"dense_fa": 2, "fts_tr_all": 2}
    configs = [
        ("baseline p60 k60 fl.35", base, 60, 0.35, 60),
        ("fa2 p60 k60 fl.20", fa2, 60, 0.20, 60),
        ("fa2 p100 k60 fl.20", fa2, 60, 0.20, 100),
        ("fa2 p150 k60 fl.20", fa2, 60, 0.20, 150),
        ("fa2all p100 k60 fl.20", fa2all, 60, 0.20, 100),
        ("fa2all p150 k60 fl.20", fa2all, 60, 0.20, 150),
        ("fa2all p200 k60 fl.15", fa2all, 60, 0.15, 200),
        ("faonlyall p150 k60 fl.20", faonlyall, 60, 0.20, 150),
        ("fa2all p150 k20 fl.20", fa2all, 20, 0.20, 150),
        ("fa2all p150 k60 fl.20 top15", fa2all, 60, 0.20, 150),
    ]
    print("\nconfig | R@10 R@3 MRR S@5 S@10")
    for name, w, k, fl, p in configs:
        tk = 15 if name.endswith("top15") else 10
        print(f"{name:30s} | {recall(data, w, k, fl, pool=p, topk=tk)}")

    print("\n--- miss diagnostics (fa2all p150 k60 fl.20, top10) ---")
    w, k, fl, p = fa2all, 60, 0.20, 150
    for it, lists in data:
        kept = fuse(lists, w, k, fl, topk=10, pool=p)
        rel = set(it["relevant_ids"])
        if rel & set(kept):
            continue
        br = best_rank(it, lists, p)
        print(f"id{it['id']:>2} rel={sorted(rel)}")
        print(f"     {it['statement']}")
        print(f"     best ranks: {br}")