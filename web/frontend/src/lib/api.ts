import type {
  ConcordanceResponse,
  Evidence,
  MessageMeta,
  ModelOption,
  Provider,
  ChatSession,
  ThinkingStep,
  VerseResponse,
} from "../types";

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
  meta: MessageMeta;
  created_at: string;
}

export interface SessionDetail {
  session: ChatSession;
  messages: StoredMessage[];
}

export interface ModelsResponse {
  provider: string;
  default_model: string;
  models: ModelOption[];
}

export const fetchProviders = () =>
  getJSON<{ providers: Provider[] }>("/api/agent/providers").then((d) => d.providers);

export const fetchSessions = () =>
  getJSON<{ sessions: ChatSession[] }>("/api/agent/sessions").then((d) => d.sessions);

export const fetchSessionDetail = (id: string) =>
  getJSON<SessionDetail>(`/api/agent/sessions/${id}`);

export async function deleteSession(id: string): Promise<void> {
  await fetch(`/api/agent/sessions/${id}`, { method: "DELETE" });
}

/** Live model catalogue from the provider, fetched through the secure backend
 * path. The BYOK key travels only in the X-LLM-Key header, never in the URL. */
export async function fetchModels(provider: string, key: string): Promise<ModelsResponse> {
  const r = await fetch(`/api/agent/models?provider=${encodeURIComponent(provider)}`, {
    headers: { "X-LLM-Key": key },
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error((j as { message?: string }).message || `HTTP ${r.status}`);
  }
  return r.json() as Promise<ModelsResponse>;
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