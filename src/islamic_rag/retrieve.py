from dataclasses import dataclass, field

import numpy as np

from . import store
from .normalize import normalize
from .settings import Settings

_STOPWORDS_RAW = (
    "از به با در بر برای که چه این آن را و یا هم نیز تا اگر اما ولی پس سپس روی زیر پیش بین میان "
    "است هست بود شد می شود کرد کند کنند کنیم کنید کنی کنم کردن داشتن دارد دارند دارم داری "
    "ها های هایی ای می بشود نمی شودش کردند کرده کرده‌اند هر هیچ همه چنین چنان اینکه بنابراین "
    "من في على عن الى هذا هذه ذلك التي الذي ما لا ان كان قد ثم او ام هل كل بعض غير بين عند لدى "
    "حتى منذ خلال عبر نحو ضمن حول دون سوى سواء مثل كما كي لكي لأن أي اى هي هو هم هن نحن أنت أنتم "
    "يا أيها تلك تلكم أولئك هؤلاء"
)
_STOPWORDS = {normalize(w) for w in _STOPWORDS_RAW.split()}

_MATRIX_CACHE: dict = {}
_RRF_K = 60
_RELATIVE_FLOOR = 0.20
_PERSIAN_CHARS = set("پچژگکی")
_FA_WEIGHTS = {"dense_ar": 1.0, "dense_fa": 2.0, "fts_rec": 0.0, "fts_tr": 2.0}
_AR_WEIGHTS = {"dense_ar": 2.0, "dense_fa": 1.0, "fts_rec": 2.0, "fts_tr": 1.0}


def _query_weights(text: str) -> dict[str, float]:
    return _FA_WEIGHTS if any(c in _PERSIAN_CHARS for c in text) else _AR_WEIGHTS


@dataclass
class Candidate:
    id: str
    ids: list[str]
    sura: int
    aya_start: int
    aya_end: int
    score: float
    text_display: str
    text_index: str
    translation_fa: str
    address: str
    metadata: dict
    source: str = "quran"
    rrf_score: float = 0.0
    rerank_score: float | None = None
    signals: dict = field(default_factory=dict)


def _matrix(con, model: str, kind: str):
    key = (model, kind)
    if key not in _MATRIX_CACHE:
        rows = store.load_vectors(con, model, kind)
        ids = [r[0] for r in rows]
        mat = np.frombuffer(b"".join(r[1] for r in rows), dtype=np.float32).reshape(len(ids), -1)
        _MATRIX_CACHE[key] = (ids, mat)
    return _MATRIX_CACHE[key]


def _fts_query(text: str) -> str | None:
    tokens = [t for t in normalize(text).split() if t not in _STOPWORDS and len(t) > 1]
    tokens = tokens[:14]
    if not tokens:
        return None
    return " OR ".join('"' + t.replace('"', "") + '"' for t in tokens)


def _merge_and_build(
    con,
    ids: list[str],
    scores: dict,
    settings: Settings,
    contrib: dict | None = None,
    sources: list[str] | None = None,
) -> list[Candidate]:
    contrib = contrib or {}
    records = store.get_records(con, ids)
    if sources:
        allowed = set(sources)
        ids = [rid for rid in ids if records.get(rid) and records[rid]["source"] in allowed]
    by_sura: dict[int, list] = {}
    for rid in ids:
        r = records.get(rid)
        if r is None:
            continue
        by_sura.setdefault(r["sura"], []).append(r)
    groups: list[list] = []
    for rows in by_sura.values():
        rows.sort(key=lambda r: r["aya"])
        run = [rows[0]]
        for r in rows[1:]:
            if r["aya"] == run[-1]["aya"] + 1:
                run.append(r)
            else:
                groups.append(run)
                run = [r]
        groups.append(run)

    import json

    candidates = []
    for run in groups:
        first = run[0]
        meta = json.loads(first["metadata"])
        trs = [
            store.get_translation(con, r["id"], settings.primary_translation) for r in run
        ]
        tr_text = " ".join(t["text_display"] for t in trs if t)
        end = run[-1]["aya"]
        ref = f"{first['sura']}:{first['aya']}" + (f"-{end}" if end != first["aya"] else "")
        top_rid = max(run, key=lambda r: scores.get(r["id"], 0.0))["id"]
        rrf = scores.get(top_rid, 0.0)
        parts = contrib.get(top_rid, {})
        sem, lex = parts.get("semantic", 0.0), parts.get("lexical", 0.0)
        total = sem + lex
        signals = (
            {"semantic": round(sem / total, 4), "lexical": round(lex / total, 4)}
            if total > 0
            else {}
        )
        candidates.append(
            Candidate(
                id=first["id"],
                ids=[r["id"] for r in run],
                sura=first["sura"],
                aya_start=first["aya"],
                aya_end=end,
                score=max(scores.get(r["id"], 0.0) for r in run),
                text_display=" ".join(r["text_display"] for r in run),
                text_index=" ".join(r["text_index"] for r in run),
                translation_fa=tr_text,
                address=f"{meta.get('surah_name', '')} ({ref})",
                metadata=meta,
                source=first["source"] if "source" in first.keys() else "quran",  # noqa: SIM118 — Row needs .keys()
                rrf_score=rrf,
                signals=signals,
            )
        )
    candidates.sort(key=lambda c: -c.score)
    return candidates


def hybrid_candidates(
    settings: Settings,
    text: str,
    k: int | None = None,
    lexical_only: bool = False,
    sources: list[str] | None = None,
) -> list[Candidate]:
    k = k or settings.top_k
    pool = settings.retrieval_pool
    con = store.connect(settings.db_path)
    qn = normalize(text)
    weights = _query_weights(text)
    lists: dict[str, list[str]] = {}

    if not lexical_only:
        from .embeddings import encode

        qvec = encode([qn], settings)[0]
        for kind in ("ar", "fa"):
            ids, mat = _matrix(con, settings.embed_model, kind)
            sims = mat @ qvec
            order = np.argsort(-sims)[:pool]
            lists["dense_" + kind] = [ids[i] for i in order]

    fq = _fts_query(text)
    if fq:
        lists["fts_rec"] = [r["id"] for r in store.fts_search_records(con, fq, pool)]
        tr_hits = store.fts_search_translations(con, fq, pool * 4)
        lists["fts_tr"] = [
            r["id"] for r in tr_hits if r["translator_id"] == settings.primary_translation
        ][:pool]

    fused: dict[str, float] = {}
    contrib: dict[str, dict] = {}
    for name, lst in lists.items():
        w = weights.get(name, 0.0)
        if w == 0.0:
            continue
        group = "semantic" if name.startswith("dense") else "lexical"
        for rank, rid in enumerate(lst):
            add = w / (_RRF_K + rank)
            fused[rid] = fused.get(rid, 0.0) + add
            slot = contrib.setdefault(rid, {"semantic": 0.0, "lexical": 0.0})
            slot[group] += add
    ranked = sorted(fused.items(), key=lambda x: -x[1])
    if not ranked:
        con.close()
        return []
    floor = ranked[0][1] * _RELATIVE_FLOOR
    kept = [rid for rid, s in ranked if s >= floor]
    if settings.use_reranker and not lexical_only and kept:
        from .rerank import rerank_candidates, reranker_available

        if reranker_available(settings):
            pool_cands = _merge_and_build(
                con, kept[: settings.rerank_pool], fused, settings, contrib, sources
            )
            candidates = rerank_candidates(settings, qn, pool_cands)[:k]
        else:
            candidates = _merge_and_build(con, kept[:k], fused, settings, contrib, sources)
    else:
        candidates = _merge_and_build(con, kept[:k], fused, settings, contrib, sources)
    con.close()
    return candidates


def query(
    settings: Settings, text: str, k: int = 10, lexical_only: bool = False, judge: bool = False
) -> dict:
    if judge:
        from .pipeline import answer

        return answer(settings, text, use_judge=True)
    cands = hybrid_candidates(settings, text, k=k, lexical_only=lexical_only)
    return {
        "statement": text,
        "mode": "lexical" if lexical_only else "hybrid",
        "candidates": [
            {
                "id": c.id,
                "address": c.address,
                "score": round(c.score, 5),
                "text_display": c.text_display,
                "translation_fa": c.translation_fa,
            }
            for c in cands
        ],
    }