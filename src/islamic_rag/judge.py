import json
import logging
import re
import time

import httpx

from . import store
from .llm.sanitize import redact_secrets
from .retrieve import Candidate
from .settings import Settings

_log = logging.getLogger("islamic_rag.judge")

LABELS = {
    "Direct_Match",
    "Conditional_Match",
    "Contradiction",
    "Context_Mismatch",
    "Superficial_Match",
}
APPROVED = {"Direct_Match", "Conditional_Match", "Contradiction"}

_PRICING_CACHE: dict = {}
_MAX_TOKENS = 2500
_MAX_RETRY_WAIT_S = 30.0


def _error_detail(resp: httpx.Response) -> str:
    try:
        err = resp.json().get("error", {})
        msg = err.get("message", "") if isinstance(err, dict) else str(err)
    except (ValueError, AttributeError):
        msg = resp.text
    return (msg or resp.reason_phrase or "")[:200]

SYSTEM_PROMPT = """You are a strict verification judge for an Islamic citation system.
You NEVER produce, rewrite, or paraphrase any Quranic text. You only classify candidates.

For the user's statement and each candidate verse, assign exactly one label:
- Direct_Match: the verse affirms and aligns with the statement.
- Conditional_Match: the verse accepts the statement's core and adds a compatible qualification. If the statement claims universality ('always', 'everywhere', 'without condition') and the verse restricts it, the core does NOT survive: use Context_Mismatch instead.
- Contradiction: the verse explicitly criticizes or refutes the statement (kept as opposing view).
- Context_Mismatch: the verse is tied to a specific historical/jurisprudential occasion and cannot be generalized to the statement.
- Superficial_Match: only lexical overlap, no real semantic relation.

Critical rules:
1. Pay attention to logical direction (negation/affirmation). Praising a trait vs condemning it are OPPOSITE.
2. sha_nuzul may be null because occasion data is absent from the source. Null does NOT mean the verse is unrestricted: the verse's own words may state conditions, exceptions or limits.
3. Use Context_Mismatch when the verse's text restricts the ruling to a specific situation, condition or group AND the statement generalizes beyond that restriction (claims it holds always, everywhere, or without any condition). A restriction stated in the text is sufficient; a reported historical occasion is not required. Do NOT use Context_Mismatch merely because sha_nuzul is null.
4. You may ONLY reference candidate ids provided in the input. Never invent ids.
5. Each candidate gives the Arabic text and its Persian translation (translation_fa). Use the translation to judge semantic alignment with the statement; the statement may be in Persian or Arabic.

6. SUBJECT GATE (apply before choosing any label): identify the specific act or topic the statement is about, and the specific act or topic the verse is about. Direct_Match, Conditional_Match and Contradiction ALL require the same act/topic. If the verse concerns a different act (for example: statement about backbiting, verse about withholding charity), label it Superficial_Match even when both mention "good", "sin", or share a positive/negative sentiment.
7. Contradiction means the verse addresses the SAME subject and asserts the opposite of the statement. Praising or condemning some other behaviour is not a contradiction of this statement.

Write every "reason" in Persian (فارسی), one short sentence, since the researcher reads Persian.
Worked example of the universality boundary: statement "X is permitted everywhere and always", candidate "do X only under condition C" -> {"id":"<candidate id>","reason":"the candidate restricts X to condition C, so the universal claim does not survive","label":"Context_Mismatch"} — NOT Conditional_Match.

Return ONLY a JSON object: {"results":[{"id":"<candidate id>","reason":"<short justification>","label":"<label>"}]}
Write the reason FIRST, then choose the label that follows from it; the label must be consistent with the reason. If your reason concludes that the verse does NOT support the statement's universal or unconditional claim, the label MUST be Context_Mismatch, never Conditional_Match. Priority between the two: if the verse DIRECTLY forbids or refutes the statement's core act (the statement says the act is good/permitted and the verse says do NOT do it), label Contradiction, even for a universal statement. Context_Mismatch is for verses that permit or command the act but restrict its scope, situation or occasion.
Include every candidate exactly once."""

CONTEXT_RULE = """8. Each candidate may carry context_before / context_after: the neighbouring verses from the same source. Read them before labelling. A condition, exception or limit stated there restricts the candidate's ruling. If the statement generalizes a ruling that the surrounding text restricts to a specific situation (fighting only those who fight you, a punishment followed by repentance, a permission granted to one specific person), label Context_Mismatch and quote the restricting phrase in the reason.
"""


def _pricing(model: str, settings: Settings) -> tuple[float, float]:
    if not _PRICING_CACHE:
        resp = httpx.get(f"{settings.openrouter_base_url}/models", timeout=30, trust_env=False)
        resp.raise_for_status()
        for m in resp.json()["data"]:
            p = m.get("pricing", {})
            _PRICING_CACHE[m["id"]] = (float(p.get("prompt", 0)), float(p.get("completion", 0)))
    return _PRICING_CACHE.get(model, (0.0, 0.0))


class BudgetError(RuntimeError):
    pass


def _guard(con, settings: Settings, model: str, est_tokens: int) -> None:
    spent = store.total_cost(con)
    pp, pc = _pricing(model, settings)
    estimate = est_tokens * pp + _MAX_TOKENS * pc
    if spent + estimate > settings.budget_cap_usd:
        raise BudgetError(
            f"budget cap reached: spent=${spent:.4f} + est=${estimate:.4f} > cap=${settings.budget_cap_usd}"
        )


def _context_view(con, rid: str | None, settings: Settings) -> dict | None:
    if not rid:
        return None
    r = store.get_records(con, [rid]).get(rid)
    if r is None:
        return None
    tr = store.get_translation(con, rid, settings.primary_translation)
    return {
        "address": f"{r['sura']}:{r['aya']}",
        "text": r["text_index"],
        "translation_fa": tr["text_display"] if tr else "",
    }


def _build_user(
    con, statement: str, candidates: list[Candidate], settings: Settings, include_context: bool
) -> str:
    items = []
    for c in candidates:
        item = {
            "id": c.id,
            "address": c.address,
            "text": c.text_index,
            "translation_fa": c.translation_fa,
            "revelation_place": c.metadata.get("revelation_place"),
            "sha_nuzul": c.metadata.get("sha_nuzul"),
        }
        if include_context:
            records = store.get_records(con, c.ids)
            first, last = records[c.ids[0]], records[c.ids[-1]]
            item["context_before"] = _context_view(con, first["prev_id"], settings)
            item["context_after"] = _context_view(con, last["next_id"], settings)
        items.append(item)
    return json.dumps(
        {"statement": statement, "candidates": items}, ensure_ascii=False, indent=2
    )


def _parse(text: str, valid_ids: set[str]) -> list[dict]:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if not m:
            return []
        try:
            data = json.loads(m.group(0))
        except json.JSONDecodeError:
            return []
    if not isinstance(data, dict):
        return []
    out = []
    seen = set()
    for r in data.get("results", []):
        if not isinstance(r, dict):
            continue
        rid, label = r.get("id"), r.get("label")
        if rid in valid_ids and label in LABELS and rid not in seen:
            seen.add(rid)
            out.append({"id": rid, "label": label, "reason": r.get("reason", "")})
    return out


def call_judge(
    settings: Settings,
    statement: str,
    candidates: list[Candidate],
    model: str | None = None,
    purpose: str = "judge",
    system_prompt: str | None = None,
    include_context: bool = False,
    client=None,
    enforce_budget: bool = True,
) -> list[dict]:
    model = model or settings.judge_model
    con = store.connect(settings.db_path)
    try:
        valid_ids = {c.id for c in candidates}
        user = _build_user(con, statement, candidates, settings, include_context)
        messages = [
            {"role": "system", "content": system_prompt or SYSTEM_PROMPT},
            {"role": "user", "content": user},
        ]
        if client is not None:
            results: list[dict] = []
            for _attempt in range(5):
                res = client.complete(
                    messages,
                    temperature=0,
                    max_tokens=_MAX_TOKENS,
                    response_format={"type": "json_object"},
                )
                store.log_usage(
                    con, res.model or model, purpose,
                    res.prompt_tokens, res.completion_tokens, 0.0,
                )
                results = _parse(res.content, valid_ids)
                if results:
                    break
                if _attempt == 0:
                    _log.warning(
                        "judge(client) parse empty: model=%s valid_ids=%s head=%r",
                        res.model or model,
                        sorted(valid_ids),
                        redact_secrets(res.content[:500], ""),
                    )
                time.sleep(1)
            return results
        if enforce_budget:
            _guard(con, settings, model, est_tokens=len(user) // 3 + 400)

        body = {
            "model": model,
            "temperature": 0,
            "max_tokens": _MAX_TOKENS,
            "response_format": {"type": "json_object"},
            "messages": messages,
        }
        headers = {
            "Authorization": f"Bearer {settings.openrouter_api_key}",
            "Content-Type": "application/json",
        }
        results: list[dict] = []
        pp, pc = _pricing(model, settings)
        waited = 0.0
        for attempt in range(5):
            try:
                resp = httpx.post(
                    f"{settings.openrouter_base_url}/chat/completions",
                    json=body,
                    headers=headers,
                    timeout=90,
                    trust_env=False,
                )
            except httpx.HTTPError as exc:
                delay = 2 * (attempt + 1)
                if waited + delay > _MAX_RETRY_WAIT_S:
                    raise RuntimeError(f"ارتباط با داور برقرار نشد: {exc}") from exc
                time.sleep(delay)
                waited += delay
                continue
            if resp.status_code == 429 or resp.status_code >= 500:
                try:
                    delay = float(resp.headers.get("retry-after", "")) + 1
                except ValueError:
                    delay = 3 * (attempt + 1)
                delay = min(delay, 30)
                if waited + delay > _MAX_RETRY_WAIT_S:
                    raise RuntimeError(
                        f"داور در دسترس نیست (HTTP {resp.status_code})؛ سقف انتظار برای تلاش مجدد پر شد."
                    )
                time.sleep(delay)
                waited += delay
                continue
            if resp.status_code >= 400:
                raise RuntimeError(f"داور HTTP {resp.status_code}: {_error_detail(resp)}")
            data = resp.json()
            usage = data.get("usage", {})
            pt = usage.get("prompt_tokens", len(user) // 3)
            ct = usage.get("completion_tokens", 0)
            store.log_usage(con, model, purpose, pt, ct, pt * pp + ct * pc)
            content = data["choices"][0]["message"]["content"]
            results = _parse(content, valid_ids)
            if results:
                break
            time.sleep(1)
        return results
    finally:
        con.close()