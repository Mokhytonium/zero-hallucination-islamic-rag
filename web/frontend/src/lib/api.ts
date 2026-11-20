import type { Evidence, Provider, SessionSummary, ThinkingStep } from "./types";

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  evidence: Evidence[];
  trace: ThinkingStep[];
  meta: Record<string, unknown>;
  created_at: string;
}

export interface SessionDetail {
  session: SessionSummary;
  messages: StoredMessage[];
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

export const fetchProviders = () =>
  getJSON<{ providers: Provider[] }>("/api/agent/providers").then((d) => d.providers);

export const fetchSessions = () =>
  getJSON<{ sessions: SessionSummary[] }>("/api/agent/sessions").then((d) => d.sessions);

export const fetchSessionDetail = (id: string) =>
  getJSON<SessionDetail>(`/api/agent/sessions/${id}`);

export async function deleteSession(id: string): Promise<void> {
  await fetch(`/api/agent/sessions/${id}`, { method: "DELETE" });
}

export const fetchTranslators = () =>
  getJSON<{ translators: { id: string; name: string }[] }>("/api/translators").then(
    (d) => d.translators
  );

export const fetchVerse = (ids: string[]) =>
  getJSON<VerseResponse>(`/api/verse?ids=${encodeURIComponent(ids.join(","))}`);

export const fetchConcordance = (word: string) =>
  getJSON<ConcordanceResponse>(`/api/concordance?word=${encodeURIComponent(word)}`);

export const fetchStatus = () => getJSON<Record<string, unknown>>("/api/status");