import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Evidence } from "../types";

const api = vi.hoisted(() => ({
  fetchProviders: vi.fn(),
  fetchSessions: vi.fn(),
  fetchSessionDetail: vi.fn(),
  deleteSession: vi.fn(),
  fetchModels: vi.fn(),
}));
const sse = vi.hoisted(() => ({ streamChat: vi.fn() }));

vi.mock("../lib/api", () => api);
vi.mock("../lib/sse", () => sse);

import { useStore } from "./useStore";

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}

const evidence: Evidence = {
  doc_id: "quran:2:255",
  id: "quran:2:255",
  ids: ["quran:2:255"],
  address: "البقرة (2:255)",
  surah_name: "البقرة",
  sura: 2,
  aya_start: 255,
  aya_end: 255,
  label: "Direct_Match",
  reason: "آیه الکرسی",
  score: 0.8,
  rerank_score: 2.0,
  signals: { semantic: 0.72, lexical: 0.41 },
  text_display: "اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ",
  translation_fa: "خداوندی جز او نیست",
  revelation_place: "Medinan",
  page: 42,
  juz: 3,
  context: { before: null, after: null },
  external_url: "https://quran.com/2/255",
  tier: 1,
};

function reset() {
  useStore.setState({
    providers: [],
    sessions: [],
    activeSessionId: null,
    messages: [],
    evidenceDict: {},
    rejectedRefs: [],
    streaming: false,
    loadingSession: false,
    error: null,
    plainArabic: false,
    drawer: null,
    byok: { provider: "openrouter", model: "", key: "sk-test-key" },
    models: [],
    isLoadingModels: false,
    fetchStatus: null,
    fetchError: null,
    cost: { prompt: 0, completion: 0 },
    abort: null,
  });
}

function script(events: [string, Record<string, unknown>][]): Promise<void> {
  sse.streamChat.mockImplementation(
    async (_payload: unknown, _key: string, _signal: AbortSignal, onEvent: (n: string, d: Record<string, unknown>) => void) => {
      for (const [n, d] of events) onEvent(n, d);
    }
  );
  return Promise.resolve();
}

beforeEach(() => {
  vi.stubGlobal("sessionStorage", new MemStorage());
  vi.clearAllMocks();
  api.fetchSessions.mockResolvedValue([]);
  api.fetchProviders.mockResolvedValue([]);
  reset();
});

describe("send contract", () => {
  it("omits deep_research and forwards provider + model", async () => {
    useStore.setState({ byok: { provider: "google", model: "gemini-2.5-flash", key: "sk-test-key" } });
    let captured: Record<string, unknown> = {};
    sse.streamChat.mockImplementation(async (payload: Record<string, unknown>) => {
      captured = payload;
    });
    await useStore.getState().send("پرسش");
    expect(captured).not.toHaveProperty("deep_research");
    expect(captured.message).toBe("پرسش");
    expect(captured.provider).toBe("google");
    expect(captured.model).toBe("gemini-2.5-flash");
  });

  it("requires a key before streaming", async () => {
    useStore.setState({ byok: { provider: "openrouter", model: "", key: "" } });
    await useStore.getState().send("پرسش");
    expect(sse.streamChat).not.toHaveBeenCalled();
    expect(useStore.getState().error).toBeTruthy();
  });
});

describe("stream handling", () => {
  it("adapts evidence_payload into the dictionary and buffers split REF tags", async () => {
    script([
      ["session", { session_id: "s1" }],
      ["thinking_step", { hop: 1, phase: "retrieval", title: "بازیابی", detail: "" }],
      ["evidence_payload", evidence as unknown as Record<string, unknown>],
      ["text_delta", { delta: "متن [[REF:quran:" }],
      ["text_delta", { delta: "2:255]] پایان" }],
      ["done", { message_id: "m1", latency_s: 3.4, hops_used: 1 }],
    ]);
    await useStore.getState().send("پرسش");
    const st = useStore.getState();
    expect(st.activeSessionId).toBe("s1");
    expect(st.evidenceDict["quran:2:255"].confidence).toBe(88);
    const assistant = st.messages.find((m) => m.role === "assistant")!;
    expect(assistant.trace).toHaveLength(1);
    expect(assistant.evidence).toHaveLength(1);
    expect(assistant.segments).toContainEqual({ type: "ref", docId: "quran:2:255" });
    expect(assistant.segments.map((s) => (s.type === "text" ? s.text : "")).join("")).not.toContain("[[REF:");
    expect(assistant.isNotFound).toBe(false);
    expect(assistant.streaming).toBe(false);
    expect(st.streaming).toBe(false);
  });

  it("merges streamed text packets into a single run without breaking words", async () => {
    script([
      ["text_delta", { delta: "هی" }],
      ["text_delta", { delta: "چ یک از این آیات" }],
      ["text_delta", { delta: "، استثنا" }],
      ["done", { message_id: "m1", latency_s: 1, hops_used: 1 }],
    ]);
    await useStore.getState().send("پرسش");
    const assistant = useStore.getState().messages.find((m) => m.role === "assistant")!;
    expect(assistant.segments).toEqual([
      { type: "text", text: "هیچ یک از این آیات، استثنا" },
    ]);
  });

  it("marks not-found when done arrives with no evidence", async () => {
    script([
      ["text_delta", { delta: "هیچ آیه‌ی تأییدشده‌ای در پایگاه داده برای این گزاره یافت نشد." }],
      ["done", { message_id: "m1", latency_s: 2.1, hops_used: 1 }],
    ]);
    await useStore.getState().send("نامرتبط");
    const assistant = useStore.getState().messages.find((m) => m.role === "assistant")!;
    expect(assistant.isNotFound).toBe(true);
  });

  it("records rejected refs and accumulates cost", async () => {
    script([
      ["ref_rejected", { doc_id: "quran:9:9" }],
      ["cost", { prompt_tokens: 100, completion_tokens: 20 }],
      ["cost", { prompt_tokens: 50, completion_tokens: 5 }],
      ["done", { message_id: "m1", latency_s: 1, hops_used: 1 }],
    ]);
    await useStore.getState().send("پرسش");
    const st = useStore.getState();
    expect(st.rejectedRefs).toContain("quran:9:9");
    expect(st.cost).toEqual({ prompt: 150, completion: 25 });
  });
});

describe("models", () => {
  it("fetches live models, picks the default and persists to sessionStorage", async () => {
    api.fetchModels.mockResolvedValue({
      provider: "openrouter",
      default_model: "google/gemini-2.5-flash",
      models: [
        { id: "a/b", name: "B", provider: "openrouter", recommended: false },
        { id: "google/gemini-2.5-flash", name: "Flash", provider: "openrouter", recommended: true },
      ],
    });
    const ok = await useStore.getState().fetchModels("openrouter", "sk-live-key");
    expect(ok).toBe(true);
    const st = useStore.getState();
    expect(st.models).toHaveLength(2);
    expect(st.byok.model).toBe("google/gemini-2.5-flash");
    expect(st.fetchStatus).toContain("2");
    expect(sessionStorage.getItem("qr_byok_key")).toBe("sk-live-key");
    expect(sessionStorage.getItem("qr_byok_model")).toBe("google/gemini-2.5-flash");
  });

  it("surfaces a fetch error and returns false", async () => {
    api.fetchModels.mockRejectedValue(new Error("HTTP 401"));
    const ok = await useStore.getState().fetchModels("openrouter", "bad-key");
    expect(ok).toBe(false);
    expect(useStore.getState().fetchError).toBe("HTTP 401");
    expect(useStore.getState().isLoadingModels).toBe(false);
  });
});

describe("session loading", () => {
  it("exposes a loading flag while a conversation is fetched", async () => {
    let resolve!: (value: unknown) => void;
    api.fetchSessionDetail.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      })
    );
    const pending = useStore.getState().selectSession("s1");
    expect(useStore.getState().loadingSession).toBe(true);
    resolve({
      session: { id: "s1", title: "گفت‌وگو", created_at: "", updated_at: "" },
      messages: [],
    });
    await pending;
    expect(useStore.getState().loadingSession).toBe(false);
    expect(useStore.getState().activeSessionId).toBe("s1");
  });

  it("clears loading and reports a friendly error when the fetch fails", async () => {
    api.fetchSessionDetail.mockRejectedValue(new Error("boom"));
    await useStore.getState().selectSession("s2");
    expect(useStore.getState().loadingSession).toBe(false);
    expect(useStore.getState().error).toContain("بازکردن گفت‌وگو");
  });
});

describe("cancel", () => {
  it("aborts the in-flight request", async () => {
    let signal: AbortSignal | undefined;
    sse.streamChat.mockImplementation(
      (_p: unknown, _k: string, sig: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          signal = sig;
          sig.addEventListener("abort", () => {
            const e = new Error("aborted");
            e.name = "AbortError";
            reject(e);
          });
        })
    );
    const pending = useStore.getState().send("پرسش");
    expect(useStore.getState().streaming).toBe(true);
    useStore.getState().cancel();
    await pending;
    expect(signal?.aborted).toBe(true);
    expect(useStore.getState().streaming).toBe(false);
  });
});