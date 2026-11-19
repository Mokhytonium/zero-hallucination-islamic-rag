"""Controlled A/B test of judge prompts on identical retrieved candidates.

Retrieval runs once per item and both prompts judge the same candidate list, so any
difference is attributable to the prompt alone. Reports two things:
  * label accuracy on the gold-relevant verses (same criterion as eval/run.py)
  * off-target approvals: Direct_Match/Conditional_Match given to candidates whose
    verses are NOT in the gold relevance set. The main eval never counts these, yet
    they are what a researcher sees as a wrong "main match" card.

Caveat: gold relevance lists are not exhaustive, so off-target counts are an upper
bound on real false approvals, not a proven error count. Compare A vs B, not absolutes.

    uv run python eval/judge_ab.py --ids 7,13,15,21,24,32,33,35,36,39,41,43
    uv run python eval/judge_ab.py --variants C,E --out eval/judge_ab_ce.json
"""

import argparse
import hashlib
import json
import time
from dataclasses import asdict
from pathlib import Path

from run import load_gold

from islamic_rag.judge import APPROVED, CONTEXT_RULE, SYSTEM_PROMPT, BudgetError, call_judge
from islamic_rag.retrieve import Candidate, hybrid_candidates
from islamic_rag.settings import Settings

# Frozen pre-adoption prompt (0.3.1). Variants B-E are built from this snapshot so
# historical comparisons stay reproducible after SYSTEM_PROMPT is tuned; variant A
# always reflects the live production prompt.
LEGACY_PROMPT = """You are a strict verification judge for an Islamic citation system.
You NEVER produce, rewrite, or paraphrase any Quranic text. You only classify candidates.

For the user's statement and each candidate verse, assign exactly one label:
- Direct_Match: the verse affirms and aligns with the statement.
- Conditional_Match: the verse accepts the statement's core but adds a condition/qualification.
- Contradiction: the verse explicitly criticizes or refutes the statement (kept as opposing view).
- Context_Mismatch: the verse is tied to a specific historical/jurisprudential occasion and cannot be generalized to the statement.
- Superficial_Match: only lexical overlap, no real semantic relation.

Critical rules:
1. Pay attention to logical direction (negation/affirmation). Praising a trait vs condemning it are OPPOSITE.
2. If a candidate's sha_nuzul is null, treat it as a general verse with no specific occasion; do NOT label it Context_Mismatch merely for lacking an occasion.
3. Only use Context_Mismatch when a specific reported occasion truly blocks generalization.
4. You may ONLY reference candidate ids provided in the input. Never invent ids.
5. Each candidate gives the Arabic text and its Persian translation (translation_fa). Use the translation to judge semantic alignment with the statement; the statement may be in Persian or Arabic.

Return ONLY a JSON object: {"results":[{"id":"<candidate id>","label":"<label>","reason":"<short justification>"}]}
Include every candidate exactly once."""

SUBJECT_GATE = """6. SUBJECT GATE (apply before choosing any label): identify the specific act or topic the statement is about, and the specific act or topic the verse is about. Direct_Match, Conditional_Match and Contradiction ALL require the same act/topic. If the verse concerns a different act (for example: statement about backbiting, verse about withholding charity), label it Superficial_Match even when both mention "good", "sin", or share a positive/negative sentiment.
7. Contradiction means the verse addresses the SAME subject and asserts the opposite of the statement. Praising or condemning some other behaviour is not a contradiction of this statement.
"""
PROMPT_B = LEGACY_PROMPT.replace(
    "\nReturn ONLY a JSON object", "\n" + SUBJECT_GATE + "\nReturn ONLY a JSON object"
)
PROMPT_D = PROMPT_B.replace(
    "\nReturn ONLY a JSON object", "\n" + CONTEXT_RULE + "\nReturn ONLY a JSON object"
)
PERSIAN_REASON = (
    'Write every "reason" in Persian (فارسی), one short sentence, since the researcher reads Persian.\n'
)
PROMPT_C = PROMPT_B.replace("Return ONLY a JSON object", PERSIAN_REASON + "Return ONLY a JSON object")
PROMPT_E = PROMPT_D.replace("Return ONLY a JSON object", PERSIAN_REASON + "Return ONLY a JSON object")

# Round 3: round 2 showed the judge answers universal claims ("in every time and
# place", "without any condition") with Conditional_Match, because the label
# definition says "accepts the core but adds a condition" — while the core of a
# universal claim IS its universality. id33 showed a second error: the judge locks
# onto the base act ("eating") instead of the modified act ("extravagance in eating").
GATE_V2 = SUBJECT_GATE.replace(
    "identify the specific act or topic the statement is about, and",
    "identify the specific act or topic the statement is about, INCLUDING its modifiers "
    "('extravagance in eating' is a different subject from 'eating'), and",
)
UNIVERSALITY_RULE = """8. UNIVERSAL CLAIMS: if the statement asserts a ruling holds universally or unconditionally (words like "always", "every time and place", "without any condition", "is free/permitted"), then a verse restricting that ruling to a specific situation, condition or occasion does NOT accept the statement's core — the universality IS the core. Label such a candidate Context_Mismatch, not Conditional_Match, and name the restriction in the reason. Reserve Conditional_Match for statements whose core survives the verse's qualification.
"""
PROMPT_F = LEGACY_PROMPT.replace(
    "\nReturn ONLY a JSON object", "\n" + GATE_V2 + UNIVERSALITY_RULE + "\nReturn ONLY a JSON object"
)
PROMPT_G = PROMPT_F.replace(
    "\nReturn ONLY a JSON object",
    "\n" + CONTEXT_RULE.replace("8.", "9.", 1) + "\nReturn ONLY a JSON object",
)
PROMPT_H = PROMPT_F.replace("Return ONLY a JSON object", PERSIAN_REASON + "Return ONLY a JSON object")

# Round 4: round 3 showed (a) rules 2-3 gate Context_Mismatch on a *reported
# occasion*, which is always null in this source, so textual restrictions can never
# fire it (id36 reasons explicitly note "the statement asserts unconditional
# permission" yet still emit Conditional_Match); (b) the output schema emits the
# label BEFORE the reason, and id33's reason said "directly contradicting" while the
# label was Direct_Match — the model commits before it reasons.
RULES_23_OLD = (
    "2. If a candidate's sha_nuzul is null, treat it as a general verse with no specific occasion; do NOT label it Context_Mismatch merely for lacking an occasion.\n"
    "3. Only use Context_Mismatch when a specific reported occasion truly blocks generalization."
)
RULES_23_NEW = (
    "2. sha_nuzul may be null because occasion data is absent from the source. Null does NOT mean the verse is unrestricted: the verse's own words may state conditions, exceptions or limits.\n"
    "3. Use Context_Mismatch when the verse's text restricts the ruling to a specific situation, condition or group AND the statement generalizes beyond that restriction (claims it holds always, everywhere, or without any condition). A restriction stated in the text is sufficient; a reported historical occasion is not required. Do NOT use Context_Mismatch merely because sha_nuzul is null."
)
COND_OLD = "- Conditional_Match: the verse accepts the statement's core but adds a condition/qualification."
COND_NEW = (
    "- Conditional_Match: the verse accepts the statement's core and adds a compatible qualification. "
    "If the statement claims universality ('always', 'everywhere', 'without condition') and the verse restricts it, "
    "the core does NOT survive: use Context_Mismatch instead."
)
OUTPUT_OLD = (
    'Return ONLY a JSON object: {"results":[{"id":"<candidate id>","label":"<label>","reason":"<short justification>"}]}\n'
    "Include every candidate exactly once."
)
OUTPUT_REASON_FIRST = (
    'Return ONLY a JSON object: {"results":[{"id":"<candidate id>","reason":"<short justification>","label":"<label>"}]}\n'
    "Write the reason FIRST, then choose the label that follows from it; the label must be consistent with the reason.\n"
    "Include every candidate exactly once."
)


def _reason_first(prompt: str) -> str:
    return prompt.replace(OUTPUT_OLD, OUTPUT_REASON_FIRST)


PROMPT_K = _reason_first(PROMPT_B)
_BASE_I = LEGACY_PROMPT.replace(RULES_23_OLD, RULES_23_NEW).replace(COND_OLD, COND_NEW)
PROMPT_I = _reason_first(
    _BASE_I.replace("\nReturn ONLY a JSON object", "\n" + SUBJECT_GATE + "\nReturn ONLY a JSON object")
)
PROMPT_J = PROMPT_I.replace("Return ONLY a JSON object", PERSIAN_REASON + "Return ONLY a JSON object")

# Round 5: round 4 fixed id33 (reason-first) and halved off-target approvals, but
# id36's reasons now explicitly conclude "the verse does not state absolute,
# unconditional killing" while the label STILL comes out Conditional_Match — the
# label name's prior beats the written rules. Add a generic worked example and an
# explicit reason->label entailment (no item-specific content).
ENTAILMENT = (
    " If your reason concludes that the verse does NOT support the statement's universal or unconditional claim, "
    "the label MUST be Context_Mismatch, never Conditional_Match."
)
EXAMPLE = (
    "\nWorked example of the universality boundary: statement \"X is permitted everywhere and always\", "
    "candidate \"do X only under condition C\" -> "
    '{"id":"<candidate id>","reason":"the candidate restricts X to condition C, so the universal claim does not survive","label":"Context_Mismatch"}'
    " — NOT Conditional_Match.\n"
)
PROMPT_L = PROMPT_J.replace(
    "the label must be consistent with the reason.",
    "the label must be consistent with the reason." + ENTAILMENT,
).replace("\nReturn ONLY a JSON object", EXAMPLE + "\nReturn ONLY a JSON object")

# Round 6: L fixed id36 (ok=True, off=0) but regressed id33 — the entailment clause
# pushes a DIRECT prohibition ("do not be extravagant") into Context_Mismatch instead
# of Contradiction. Priority: refuting the act itself outranks restricting its scope.
PRIORITY = (
    " Priority between the two: if the verse DIRECTLY forbids or refutes the statement's core act "
    "(the statement says the act is good/permitted and the verse says do NOT do it), label Contradiction, "
    "even for a universal statement. Context_Mismatch is for verses that permit or command the act "
    "but restrict its scope, situation or occasion."
)
PROMPT_M = PROMPT_L.replace(ENTAILMENT, ENTAILMENT + PRIORITY)
# letter -> (report key, system prompt, send neighbouring verses to the judge)
VARIANTS = {
    "A": ("A_current", SYSTEM_PROMPT, False),
    "B": ("B_subject_gate", PROMPT_B, False),
    "C": ("C_persian_reason", PROMPT_C, False),
    "D": ("D_context", PROMPT_D, True),
    "E": ("E_gate_context_fa", PROMPT_E, True),
    "F": ("F_universality", PROMPT_F, False),
    "G": ("G_universality_ctx", PROMPT_G, True),
    "H": ("H_gate_univ_fa", PROMPT_H, False),
    "I": ("I_textual_occasion", PROMPT_I, False),
    "J": ("J_textual_occasion_fa", PROMPT_J, False),
    "K": ("K_reason_first", PROMPT_K, False),
    "L": ("L_entailment_example", PROMPT_L, False),
    "M": ("M_priority", PROMPT_M, False),
}
MATCH_LABELS = {"Direct_Match", "Conditional_Match"}
CAND_CACHE = Path(__file__).resolve().parent / "cand_cache.json"


def _cache_key(settings: Settings, text: str, k: int) -> str:
    blob = json.dumps(
        [text, k, settings.use_reranker, settings.rerank_pool, settings.retrieval_pool,
         settings.primary_translation, settings.embed_model, settings.reranker_model],
        ensure_ascii=False, sort_keys=True,
    )
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]


def cached_candidates(settings: Settings, text: str, k: int, cache: dict) -> list[Candidate]:
    key = _cache_key(settings, text, k)
    if key not in cache:
        cache[key] = [asdict(c) for c in hybrid_candidates(settings, text, k=k)]
        CAND_CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    return [Candidate(**d) for d in cache[key]]


def score(item: dict, cands: list, verdicts: list[dict]) -> dict:
    rel = set(item["relevant_ids"])
    vmap = {v["id"]: v["label"] for v in verdicts}
    label_by_rid = {rid: vmap.get(c.id) for c in cands for rid in c.ids}
    off_target = [c for c in cands if not (set(c.ids) & rel)]
    return {
        "ok": any(label_by_rid.get(r) == item["expected_label"] for r in rel),
        "got": {r: label_by_rid.get(r) for r in sorted(rel)},
        "off_approvals": [c.id for c in off_target if vmap.get(c.id) in MATCH_LABELS],
        "off_contradictions": [c.id for c in off_target if vmap.get(c.id) == "Contradiction"],
        "labels": vmap,
        "reasons": {v["id"]: v.get("reason", "") for v in verdicts},
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", default="7,13,15,21,24,32,33,35,36,39,41,43")
    ap.add_argument("--variants", default="A,B", help="A current, B gate, C B+fa, D B+ctx, E D+fa, F gate-v2+univ, G F+ctx, H F+fa, I textual-occasion+reason-first, J I+fa, K B+reason-first, L J+entailment+example")
    ap.add_argument("--out", type=Path, default=Path("eval/judge_ab.json"))
    args = ap.parse_args()

    if (
        PROMPT_B == LEGACY_PROMPT or PROMPT_C == PROMPT_B or PROMPT_D == PROMPT_B
        or PROMPT_E == PROMPT_D or PROMPT_F == LEGACY_PROMPT or PROMPT_G == PROMPT_F
        or PROMPT_H == PROMPT_F or GATE_V2 == SUBJECT_GATE
        or PROMPT_K == PROMPT_B or PROMPT_I == PROMPT_B or PROMPT_J == PROMPT_I
        or PROMPT_L == PROMPT_J or PROMPT_M == PROMPT_L
    ):
        raise SystemExit("prompt anchor not found; variants were not constructed")

    settings = Settings()
    wanted = {int(x) for x in args.ids.split(",") if x.strip()}
    gold = [g for g in load_gold() if g["id"] in wanted]
    letters = [x.strip().upper() for x in args.variants.split(",") if x.strip()]
    if any(letter not in VARIANTS for letter in letters):
        raise SystemExit(f"unknown variant in {letters}; choose from {sorted(VARIANTS)}")
    variants = {VARIANTS[letter][0]: VARIANTS[letter][1:] for letter in letters}
    cache = json.loads(CAND_CACHE.read_text(encoding="utf-8")) if CAND_CACHE.exists() else {}
    rows = []

    for item in gold:
        t0 = time.perf_counter()
        cands = cached_candidates(settings, item["statement"], settings.top_k, cache)[
            : settings.max_candidates_per_source
        ]
        retrieval_s = round(time.perf_counter() - t0, 1)
        rel = set(item["relevant_ids"])
        if not (rel & {rid for c in cands for rid in c.ids}):
            print(f"id{item['id']:>2} not retrieved; skipped", flush=True)
            rows.append({"id": item["id"], "status": "not_retrieved"})
            continue
        row = {
            "id": item["id"],
            "statement": item["statement"],
            "category": item["category"],
            "expected": item["expected_label"],
            "retrieval_s": retrieval_s,
            "candidates": [c.id for c in cands],
        }
        for name, (prompt, include_context) in variants.items():
            try:
                verdicts = call_judge(
                    settings, item["statement"], cands, purpose="eval_ab",
                    system_prompt=prompt, include_context=include_context,
                )
            except BudgetError:
                print("[judge] budget cap reached; stopping", flush=True)
                args.out.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
                return
            except Exception as exc:  # noqa: BLE001 - one API failure must not abort the experiment
                row[name] = {"status": "judge_error", "error": str(exc)}
                print(f"id{item['id']:>2} {name} ERROR {exc}", flush=True)
                continue
            row[name] = score(item, cands, verdicts) if verdicts else {"status": "empty"}
            time.sleep(2.0)
        rows.append(row)
        parts = [
            f"{name.split('_')[0]} ok={row.get(name, {}).get('ok')} "
            f"off={len(row.get(name, {}).get('off_approvals', []))}"
            for name in variants
        ]
        print(f"id{item['id']:>2} {item['category']:<14} " + " | ".join(parts), flush=True)

    summary = {}
    for name in variants:
        scored = [r[name] for r in rows if isinstance(r.get(name), dict) and "ok" in r[name]]
        if not scored:
            continue
        summary[name] = {
            "judged_items": len(scored),
            "label_accuracy": round(sum(s["ok"] for s in scored) / len(scored), 4),
            "off_target_approvals": sum(len(s["off_approvals"]) for s in scored),
            "off_target_contradictions": sum(len(s["off_contradictions"]) for s in scored),
            "items_with_off_target_approval": sum(bool(s["off_approvals"]) for s in scored),
        }
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)
    args.out.write_text(
        json.dumps({"summary": summary, "approved_set": sorted(APPROVED), "items": rows},
                   ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()