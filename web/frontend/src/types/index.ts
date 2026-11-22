export type ProviderId = "openrouter" | "google" | "openai";

export interface ModelOption {
  id: string;
  name: string;
  provider: ProviderId;
  contextLength?: string | null;
  isFree?: boolean;
  recommended?: boolean;
}

export type VerdictLabel = "Direct_Match" | "Conditional_Match" | "Contradiction";

export interface ContextVerse {
  aya: number;
  arabic: string;
  translation: string;
}

/** View-model rendered by InlineVerseCard / EvidenceDrawer. Adapted from the
 * byte-exact backend evidence_payload — never produced by the LLM. */
export interface VerifiedVerse {
  doc_id: string;
  ids: string[];
  source: "quran";
  surah_name: string;
  sura: number;
  aya: number;
  address: string;
  revelation_place: string;
  page: number | null;
  juz: number | null;
  label: VerdictLabel;
  confidence: number;
  reason: string;
  text_display: string;
  text_plain: string;
  translations: Record<string, string>;
  external_url: string;
  context: { before: ContextVerse | null; after: ContextVerse | null };
  signals: { semantic: number; lexical: number };
  tier: number;
}

export interface ThinkingStep {
  hop: number;
  phase?: string;
  title: string;
  detail?: string;
  queries?: string[];
}

export type Segment =
  | { type: "text"; text: string }
  | { type: "ref"; docId: string };

export interface MessageMeta {
  message_id?: string;
  hops_used?: number;
  latency_s?: number;
  candidates_considered?: number;
  judge_model?: string;
  cancelled?: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  segments: Segment[];
  evidence: VerifiedVerse[];
  trace: ThinkingStep[];
  meta?: MessageMeta;
  streaming?: boolean;
  isNotFound?: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

/* ---- Backend API shapes (raw) ---- */

export type Label = VerdictLabel | "Unverified";

export interface VerseView {
  id: string;
  address: string;
  text_display: string;
  translation_fa: string;
}

export interface Evidence {
  doc_id: string;
  id: string;
  ids: string[];
  address: string;
  surah_name: string;
  sura: number;
  aya_start: number;
  aya_end: number;
  label: Label;
  reason: string;
  score: number;
  rrf_score?: number;
  rerank_score?: number | null;
  signals?: Record<string, number>;
  text_display: string;
  translation_fa: string;
  revelation_place?: string | null;
  page?: number | null;
  juz?: number | null;
  context: { before: VerseView | null; after: VerseView | null };
  external_url: string;
  tier: number;
  tafsir_snippet?: string | null;
}

export interface Provider {
  id: string;
  label: string;
  default_model: string;
  models: string[];
}

export interface VerseBlock {
  id: string;
  address: string;
  text_display: string;
  translations: Record<string, string>;
}

export interface VerseResponse {
  id: string;
  ids: string[];
  sura: number;
  aya_start: number;
  aya_end: number;
  surah_name: string;
  surah_name_en: string;
  revelation_place?: string | null;
  page?: number | null;
  juz?: number | null;
  text_display: string;
  words: { word: string }[];
  translations: Record<string, string>;
  before: VerseBlock | null;
  after: VerseBlock | null;
}

export interface ConcordanceResponse {
  word: string;
  count: number;
  samples: { id: string; address: string }[];
}