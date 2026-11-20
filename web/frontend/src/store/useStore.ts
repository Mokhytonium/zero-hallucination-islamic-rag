import { create } from "zustand";
import {
  deleteSession,
  fetchProviders,
  fetchSessionDetail,
  fetchSessions,
} from "../lib/api";
import { RefStreamParser, parseFull } from "../lib/refs";
import { streamChat } from "../lib/sse";
import type {
  ChatMessage,
  Evidence,
  Provider,
  Segment,
  SessionSummary,
  ThinkingStep,
} from "../lib/types";

const KEY_STORAGE = "qr_byok_key";
const PROVIDER_STORAGE = "qr_byok_provider";
const MODEL_STORAGE = "qr_byok_model";

interface Byok {
  provider: string;
  model: string;
  key: string;
}

interface State {
  providers: Provider[];
  sessions: SessionSummary[];
  activeSessionId: string | null;
  messages: ChatMessage[];
  evidenceDict: Record<string, Evidence>;
  rejectedRefs: string[];
  streaming: boolean;
  error: string | null;
  deepResearch: boolean;
  diacritics: boolean;
  drawer: Evidence | null;
  byok: Byok;
  cost: { prompt: number; completion: number };
  lastMeta: Record<string, unknown> | null;
  abort: AbortController | null;

  init: () => Promise<void>;
  setByok: (p: Partial<Byok>) => void;
  newChat: () => void;
  selectSession: (id: string) => Promise<void>;
  removeSession: (id: string) => Promise<void>;
  send: (message: string) => Promise<void>;
  cancel: () => void;
  toggleDeep: () => void;
  toggleDiacritics: () => void;
  openDrawer: (e: Evidence) => void;
  closeDrawer: () => void;
}

let counter = 0;
const uid = () => `m${Date.now()}_${counter++}`;

function loadByok(): Byok {
  return {
    provider: sessionStorage.getItem(PROVIDER_STORAGE) || "openrouter",
    model: sessionStorage.getItem(MODEL_STORAGE) || "",
    key: sessionStorage.getItem(KEY_STORAGE) || "",
  };
}

export const useStore = create<State>((set, get) => ({
  providers: [],
  sessions: [],
  activeSessionId: null,
  messages: [],
  evidenceDict: {},
  rejectedRefs: [],
  streaming: false,
  error: null,
  deepResearch: false,
  diacritics: true,
  drawer: null,
  byok: { provider: "openrouter", model: "", key: "" },
  cost: { prompt: 0, completion: 0 },
  lastMeta: null,
  abort: null,

  init: async () => {
    set({ byok: loadByok() });
    try {
      const [providers, sessions] = await Promise.all([fetchProviders(), fetchSessions()]);
      set({ providers, sessions });
    } catch {
      /* backend offline; UI still renders */
    }
  },

  setByok: (p) => {
    const byok = { ...get().byok, ...p };
    if (p.key !== undefined) sessionStorage.setItem(KEY_STORAGE, p.key);
    if (p.provider !== undefined) sessionStorage.setItem(PROVIDER_STORAGE, p.provider);
    if (p.model !== undefined) sessionStorage.setItem(MODEL_STORAGE, p.model);
    set({ byok });
  },

  newChat: () =>
    set({
      activeSessionId: null,
      messages: [],
      evidenceDict: {},
      rejectedRefs: [],
      error: null,
      cost: { prompt: 0, completion: 0 },
      lastMeta: null,
      drawer: null,
    }),

  selectSession: async (id) => {
    const detail = await fetchSessionDetail(id);
    const dict: Record<string, Evidence> = {};
    const messages: ChatMessage[] = detail.messages.map((m) => {
      for (const e of m.evidence || []) dict[e.doc_id] = e;
      return {
        id: m.id,
        role: m.role,
        segments: m.role === "assistant" ? parseFull(m.content || "") : [{ type: "text", text: m.content || "" }],
        evidence: m.evidence || [],
        trace: m.trace || [],
        meta: m.meta || {},
      };
    });
    set({
      activeSessionId: id,
      messages,
      evidenceDict: dict,
      rejectedRefs: [],
      error: null,
      drawer: null,
    });
  },

  removeSession: async (id) => {
    await deleteSession(id);
    set({ sessions: get().sessions.filter((s) => s.id !== id) });
    if (get().activeSessionId === id) get().newChat();
  },

  send: async (message) => {
    const { byok, activeSessionId, deepResearch } = get();
    if (!byok.key) {
      set({ error: "کلید API را در تنظیمات وارد کنید." });
      return;
    }
    const userMsg: ChatMessage = {
      id: uid(),
      role: "user",
      segments: [{ type: "text", text: message }],
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
      set({
        messages: get().messages.map((m) => (m.id === assistantId ? fn(m) : m)),
      });

    const onEvent = (name: string, data: Record<string, unknown>) => {
      if (name === "session") {
        set({ activeSessionId: data.session_id as string });
      } else if (name === "thinking_step") {
        patchAssistant((m) => ({ ...m, trace: [...m.trace, data as unknown as ThinkingStep] }));
      } else if (name === "evidence_payload") {
        const ev = data as unknown as Evidence;
        set({ evidenceDict: { ...get().evidenceDict, [ev.doc_id]: ev } });
        patchAssistant((m) => ({ ...m, evidence: [...m.evidence, ev] }));
      } else if (name === "text_delta") {
        const segs = parser.push((data.delta as string) || "");
        if (segs.length) patchAssistant((m) => ({ ...m, segments: [...m.segments, ...segs] }));
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
          segments: [...m.segments, ...tail],
          streaming: false,
          meta: data,
        }));
        set({ streaming: false, lastMeta: data, abort: null });
        fetchSessions().then((sessions) => set({ sessions })).catch(() => {});
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
          message,
          session_id: activeSessionId,
          provider: byok.provider,
          model: byok.model || null,
          deep_research: deepResearch,
        },
        byok.key,
        abort.signal,
        onEvent
      );
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        patchAssistant((m) => ({ ...m, streaming: false }));
        set({ streaming: false, abort: null });
      } else {
        patchAssistant((m) => ({ ...m, streaming: false }));
        set({ streaming: false, error: (err as Error).message, abort: null });
      }
    }
  },

  cancel: () => {
    get().abort?.abort();
  },

  toggleDeep: () => set({ deepResearch: !get().deepResearch }),
  toggleDiacritics: () => set({ diacritics: !get().diacritics }),
  openDrawer: (e) => set({ drawer: e }),
  closeDrawer: () => set({ drawer: null }),
}));

export type { Segment };