import type { ContextVerse, Evidence, VerifiedVerse, VerdictLabel, VerseView } from "../types";
import { stripDiacritics } from "./arabic";

const REVELATION: Record<string, string> = {
  Meccan: "مکی",
  Medinan: "مدنی",
  meccan: "مکی",
  medinan: "مدنی",
};

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function ayaFromId(id: string): number {
  const parts = id.split(":");
  const n = Number(parts[parts.length - 1]);
  return Number.isFinite(n) ? n : 0;
}

function toContext(v: VerseView | null): ContextVerse | null {
  if (!v) return null;
  return {
    aya: ayaFromId(v.id),
    arabic: v.text_display,
    translation: v.translation_fa,
  };
}

const LABELS: VerdictLabel[] = ["Direct_Match", "Conditional_Match", "Contradiction"];

/** Adapt a byte-exact backend evidence_payload into the design's view-model.
 * Every field originates from SQLite hydration; the LLM never supplies verse text. */
export function toVerifiedVerse(e: Evidence): VerifiedVerse {
  const relevance = e.rerank_score ?? e.score ?? 0;
  const label = (LABELS.includes(e.label as VerdictLabel) ? e.label : "Direct_Match") as VerdictLabel;
  return {
    doc_id: e.doc_id,
    ids: e.ids?.length ? e.ids : [e.doc_id],
    source: "quran",
    surah_name: e.surah_name,
    sura: e.sura,
    aya: e.aya_start,
    address: e.address,
    revelation_place: REVELATION[e.revelation_place ?? ""] ?? e.revelation_place ?? "",
    page: e.page ?? null,
    juz: e.juz ?? null,
    label,
    confidence: Math.max(0, Math.min(100, Math.round(sigmoid(relevance) * 100))),
    reason: e.reason ?? "",
    text_display: e.text_display,
    text_plain: stripDiacritics(e.text_display),
    translations: { makarem: e.translation_fa, "fa.makarem": e.translation_fa },
    external_url: e.external_url,
    context: { before: toContext(e.context?.before ?? null), after: toContext(e.context?.after ?? null) },
    signals: {
      semantic: Math.round((e.signals?.semantic ?? 0) * 100),
      lexical: Math.round((e.signals?.lexical ?? 0) * 100),
    },
    tier: e.tier ?? 1,
  };
}