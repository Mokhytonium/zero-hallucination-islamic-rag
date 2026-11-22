import { create } from "zustand";
import {
  deleteSession,
  fetchModels as apiFetchModels,
  fetchProviders,
  fetchSessionDetail,
  fetchSessions,
} from "../lib/api";
import { toVerifiedVerse } from "../lib/adapter";
import { RefStreamParser, appendSegments, parseFull } from "../lib/refs";
import { readBoolPref, writePref } from "../lib/persist";
import { streamChat } from "../lib/sse";
import type {
  ChatMessage,
  ChatSession,
  Evidence,
  MessageMeta,
  ModelOption,
  Provider,
  ProviderId,
  ThinkingStep,
  VerifiedVerse,
} from "../types";

const KEY_STORAGE = "qr_byok_key";
const PROVIDER_STORAGE = "qr_byok_provider";
const MODEL_STORAGE = "qr_byok_model";

interface Byok {
  provider: ProviderId;
  model: string;
  key: string;
}

interface State {
  providers: Provider[];
  sessions: ChatSession[];
  activeSessionId: string | null;
  messages: ChatMessage[];
  evidenceDict: Record<string, VerifiedVerse>;
  rejectedRefs: string[];
  streaming: boolean;
  loadingSession: boolean;
  error: string | null;
  plainArabic: boolean;
  drawer: VerifiedVerse | null;
  byok: Byok;
  models: ModelOption[];
  isLoadingModels: boolean;
  fetchStatus: string | null;
  fetchError: string | null;
  cost: { prompt: number; completion: number };
  abort: AbortController | null;

  init: () => Promise<void>;
  setByok: (p: Partial<Byok>) => void;
  setModel: (id: string) => void;
  fetchModels: (provider: ProviderId, key: string) => Promise<boolean>;
  newChat: () => void;
  selectSession: (id: string) => Promise<void>;
  removeSession: (id: string) => Promise<void>;
  send: (message: string) => Promise<void>;
  cancel: () => void;
  dismissError: () => void;
  togglePlainArabic: () => void;
  openDrawer: (v: VerifiedVerse) => void;
  closeDrawer: () => void;
}

let counter = 0;
const uid = () => `m${Date.now()}_${counter++}`;

/** Guards against a slow session fetch overwriting a newer selection. */
let sessionLoadToken = 0;

const PLAIN_ARABIC_PREF = "qr_plain_arabic";

function loadByok(): Byok {
  const provider = sessionStorage.getItem(PROVIDER_STORAGE);
  return {
    provider:
      provider === "google" || provider === "openai" || provider === "openrouter"
        ? provider
        : "openrouter",
    model: sessionStorage.getItem(MODEL_STORAGE) || "",
    key: sessionStorage.getItem(KEY_STORAGE) || "",
  };
}

function pickModel(list: ModelOption[], current: string, fallback: string): string {
  if (current && list.some((m) => m.id === current)) return current;
  if (fallback && list.some((m) => m.id === fallback)) return fallback;
  const recommended = list.find((m) => m.recommended);
  if (recommended) return recommended.id;
  return list[0]?.id ?? "";
}

export const useStore = create<State>((set, get) => ({
  providers: [],
  sessions: [],
  activeSessionId: null,
  messages: [],
  evidenceDict: {},
  rejectedRefs: [],
  streaming: false,
  loadingSession: false,
  error: null,
  plainArabic: readBoolPref(PLAIN_ARABIC_PREF, false),
  drawer: null,
  byok: { provider: "openrouter", model: "", key: "" },
  models: [],
  isLoadingModels: false,
  fetchStatus: null,
  fetchError: null,
  cost: { prompt: 0, completion: 0 },
  abort: null,

  init: async () => {
    const byok = loadByok();
    set({ byok });
    try {
      const [providers, sessions] = await Promise.all([fetchProviders(), fetchSessions()]);
      set({ providers, sessions });
    } catch {
      /* backend offline; UI still renders */
    }
    if (byok.key) await get().fetchModels(byok.provider, byok.key);
  },

  setByok: (p) => {
    const byok = { ...get().byok, ...p };
    if (p.key !== undefined) sessionStorage.setItem(KEY_STORAGE, p.key);
    if (p.provider !== undefined) sessionStorage.setItem(PROVIDER_STORAGE, p.provider);
    if (p.model !== undefined) sessionStorage.setItem(MODEL_STORAGE, p.model);
    set({ byok });
  },

  setModel: (id) => get().setByok({ model: id }),

  fetchModels: async (provider, key) => {
    set({ isLoadingModels: true, fetchStatus: null, fetchError: null });
    get().setByok({ provider, key });
    if (!key) {
      set({ isLoadingModels: false, fetchError: "کلید API وارد نشده است." });
      return false;
    }
    try {
      const res = await apiFetchModels(provider, key);
      const models = res.models;
      const selected = pickModel(models, get().byok.model, res.default_model);
      get().setByok({ model: selected });
      set({
        models,
        isLoadingModels: false,
        fetchStatus: `${models.length} مدل زنده از پروایدر دریافت شد.`,
      });
      return true;
    } catch (err) {
      set({
        isLoadingModels: false,
        fetchError: (err as Error).message || "دریافت لیست مدل‌ها ممکن نشد.",
      });
      return false;
    }
  },

  newChat: () =>
    set({
      activeSessionId: null,
      messages: [],
      evidenceDict: {},
      rejectedRefs: [],
      error: null,
      loadingSession: false,
      cost: { prompt: 0, completion: 0 },
      drawer: null,
    }),

  selectSession: async (id) => {
    const token = ++sessionLoadToken;
    set({ loadingSession: true, error: null });
    try {
      const detail = await fetchSessionDetail(id);
      if (token !== sessionLoadToken) return;
      const dict: Record<string, VerifiedVerse> = {};
      const messages: ChatMessage[] = detail.messages.map((m) => {
        const evidence = (m.evidence || []).map(toVerifiedVerse);
        for (const v of evidence) dict[v.doc_id] = v;
        return {
          id: m.id,
          role: m.role,
          segments:
            m.role === "assistant"
              ? parseFull(m.content || "")
              : [{ type: "text", text: m.content || "" }],
          evidence,
          trace: m.trace || [],
          meta: m.meta || {},
          isNotFound: m.role === "assistant" && evidence.length === 0,
        };
      });
      set({
        activeSessionId: id,
        messages,
        evidenceDict: dict,
        rejectedRefs: [],
        error: null,
        loadingSession: false,
        drawer: null,
      });
    } catch {
      if (token !== sessionLoadToken) return;
      set({
        loadingSession: false,
        error: "بازکردن گفت‌وگو ممکن نشد؛ اتصال به سرور را بررسی کنید.",
      });
    }
  },

  removeSession: async (id) => {
    await deleteSession(id);
    set({ sessions: get().sessions.filter((s) => s.id !== id) });
    if (get().activeSessionId === id) get().newChat();
  },

  send: async (message) => {
    const text = message.trim();
    const { byok, activeSessionId } = get();
    if (!text || get().streaming) return;
    if (!byok.key) {
      set({ error: "برای پژوهش، ابتدا کلید API خود را در «کلید API و مدل‌ها» وارد کنید." });
      return;
    }
    const userMsg: ChatMessage = {
      id: uid(),
      role: "user",
      segments: [{ type: "text", text }],
      evidence: [],
      trace: [],
    };
    const assistantId = uid();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: "assistant",
      segments: [],
      evidence: [],
      trace: [],
      streaming: true,
    };
    const abort = new AbortController();
    const parser = new RefStreamParser();
    set({
      messages: [...get().messages, userMsg, assistantMsg],
      streaming: true,
      error: null,
      rejectedRefs: [],
      cost: { prompt: 0, completion: 0 },
      abort,
    });

    const patchAssistant = (fn: (m: ChatMessage) => ChatMessage) =>
      set({ messages: get().messages.map((m) => (m.id === assistantId ? fn(m) : m)) });

    const onEvent = (name: string, data: Record<string, unknown>) => {
      if (name === "session") {
        set({ activeSessionId: data.session_id as string });
      } else if (name === "thinking_step") {
        patchAssistant((m) => ({ ...m, trace: [...m.trace, data as unknown as ThinkingStep] }));
      } else if (name === "evidence_payload") {
        const v = toVerifiedVerse(data as unknown as Evidence);
        set({ evidenceDict: { ...get().evidenceDict, [v.doc_id]: v } });
        patchAssistant((m) => ({ ...m, evidence: [...m.evidence, v] }));
      } else if (name === "text_delta") {
        const segs = parser.push((data.delta as string) || "");
        if (segs.length)
          patchAssistant((m) => ({ ...m, segments: appendSegments(m.segments, segs) }));
      } else if (name === "ref_rejected") {
        set({ rejectedRefs: [...get().rejectedRefs, data.doc_id as string] });
      } else if (name === "cost") {
        set({
          cost: {
            prompt: get().cost.prompt + ((data.prompt_tokens as number) || 0),
            completion: get().cost.completion + ((data.completion_tokens as number) || 0),
          },
        });
      } else if (name === "done") {
        const tail = parser.flush();
        patchAssistant((m) => ({
          ...m,
          segments: appendSegments(m.segments, tail),
          streaming: false,
          meta: data as MessageMeta,
          isNotFound: m.evidence.length === 0,
        }));
        set({ streaming: false, abort: null });
        fetchSessions()
          .then((sessions) => set({ sessions }))
          .catch(() => {});
      } else if (name === "error") {
        patchAssistant((m) => ({ ...m, streaming: false }));
        set({
          streaming: false,
          error: (data.message as string) || "خطا در پردازش پژوهش.",
          abort: null,
        });
      }
    };

    try {
      await streamChat(
        {
          message: text,
          session_id: activeSessionId,
          provider: byok.provider,
          model: byok.model || null,
        },
        byok.key,
        abort.signal,
        onEvent
      );
    } catch (err) {
      patchAssistant((m) => ({ ...m, streaming: false }));
      if ((err as Error).name === "AbortError") {
        set({ streaming: false, abort: null });
      } else {
        set({ streaming: false, error: (err as Error).message, abort: null });
      }
    }
  },

  cancel: () => {
    get().abort?.abort();
  },

  dismissError: () => set({ error: null }),

  togglePlainArabic: () => {
    const next = !get().plainArabic;
    writePref(PLAIN_ARABIC_PREF, next ? "1" : "0");
    set({ plainArabic: next });
  },
  openDrawer: (v) => set({ drawer: v }),
  closeDrawer: () => set({ drawer: null }),
}));