import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
  fetchSessions: vi.fn().mockResolvedValue([]),
  fetchProviders: vi.fn().mockResolvedValue([]),
  fetchSessionDetail: vi.fn(),
  deleteSession: vi.fn(),
}));
vi.mock("../lib/sse", () => ({ streamChat: vi.fn() }));

import { streamChat } from "../lib/sse";
import { segmentsToText } from "../lib/refs";
import { useStore } from "./useStore";

const mockStream = vi.mocked(streamChat);

function reset() {
  useStore.setState({
    messages: [],
    evidenceDict: {},
    rejectedRefs: [],
    streaming: false,
    error: null,
    deepResearch: false,
    abort: null,
    cost: { prompt: 0, completion: 0 },
    byok: { provider: "openrouter", model: "", key: "test-key" },
    activeSessionId: null,
  });
}

beforeEach(() => {
  reset();
  mockStream.mockReset();
});

describe("deep_research switch", () => {
  it("defaults to fast mode and toggles", () => {
    expect(useStore.getState().deepResearch).toBe(false);
    useStore.getState().toggleDeep();
    expect(useStore.getState().deepResearch).toBe(true);
  });

  it("sends deep_research=false in fast mode", async () => {
    mockStream.mockResolvedValue(undefined);
    await useStore.getState().send("گزاره");
    expect(mockStream.mock.calls[0][0].deep_research).toBe(false);
  });

  it("sends deep_research=true when deep mode is on", async () => {
    mockStream.mockResolvedValue(undefined);
    useStore.getState().toggleDeep();
    await useStore.getState().send("گزاره");
    expect(mockStream.mock.calls[0][0].deep_research).toBe(true);
  });

  it("requires a BYOK key before sending", async () => {
    useStore.setState({ byok: { provider: "openrouter", model: "", key: "" } });
    await useStore.getState().send("گزاره");
    expect(mockStream).not.toHaveBeenCalled();
    expect(useStore.getState().error).toBeTruthy();
  });
});

describe("stream rendering", () => {
  it("buffers a REF split across two packets without flashing raw tag", async () => {
    mockStream.mockImplementation(async (_p, _k, _s, onEvent) => {
      onEvent("session", { session_id: "s1" });
      onEvent("evidence_payload", { doc_id: "quran:17:23" });
      onEvent("text_delta", { delta: "نیکی کنید [[REF:quran:" });
      onEvent("text_delta", { delta: "17:23]] باشد." });
      onEvent("done", { message_id: "m1", latency_s: 1, hops_used: 1 });
    });
    await useStore.getState().send("گزاره");
    const state = useStore.getState();
    const assistant = state.messages.find((m) => m.role === "assistant")!;
    expect(state.evidenceDict["quran:17:23"]).toBeTruthy();
    const refs = assistant.segments.filter((s) => s.type === "ref");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toEqual({ type: "ref", docId: "quran:17:23" });
    const rawText = assistant.segments
      .filter((s) => s.type === "text")
      .map((s) => (s.type === "text" ? s.text : ""))
      .join("");
    expect(rawText).not.toContain("[[REF:");
    expect(segmentsToText(assistant.segments)).toContain("[[REF:quran:17:23]]");
    expect(state.streaming).toBe(false);
  });

  it("records rejected refs separately", async () => {
    mockStream.mockImplementation(async (_p, _k, _s, onEvent) => {
      onEvent("ref_rejected", { doc_id: "quran:99:999", reason: "invalid" });
      onEvent("done", { message_id: "m1", latency_s: 1, hops_used: 1 });
    });
    await useStore.getState().send("گزاره");
    expect(useStore.getState().rejectedRefs).toContain("quran:99:999");
  });
});