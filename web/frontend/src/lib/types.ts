export type Label =
  | "Direct_Match"
  | "Conditional_Match"
  | "Contradiction"
  | "Unverified";

export interface VerseView {
  id: string;
  address: string;
  text_display: string;
  translation_fa: string;
}

export interface Evidence {
  doc_id: string;
  ids: string[];
  address: string;
  surah_name: string;
  sura: number;
  aya_start: number;
  aya_end: number;
  label: Label;
  reason: string;
  text_display: string;
  translation_fa: string;
  revelation_place?: string | null;
  page?: number | null;
  juz?: number | null;
  context: { before: VerseView | null; after: VerseView | null };
  external_url: string;
  tier: number;
  tafsir_snippet?: string | null;
  score?: number;
  signals?: Record<string, number>;
}

export interface ThinkingStep {
  hop: number;
  phase: string;
  title: string;
  detail?: string;
  queries?: string[];
}

export interface CostEvent {
  prompt_tokens: number;
  completion_tokens: number;
  model: string;
}

export type Segment =
  | { type: "text"; text: string }
  | { type: "ref"; docId: string };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  segments: Segment[];
  evidence: Evidence[];
  trace: ThinkingStep[];
  meta?: Record<string, unknown>;
  streaming?: boolean;
}

export interface SessionSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Provider {
  id: string;
  label: string;
  default_model: string;
  models: string[];
}