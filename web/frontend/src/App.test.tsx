// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("./lib/api", () => ({
  fetchProviders: vi.fn().mockResolvedValue([
    { id: "openrouter", label: "OpenRouter", default_model: "google/gemini-2.5-flash-lite", models: ["google/gemini-2.5-flash-lite"] },
  ]),
  fetchSessions: vi.fn().mockResolvedValue([]),
  fetchSessionDetail: vi.fn(),
  deleteSession: vi.fn(),
  fetchTranslators: vi.fn().mockResolvedValue([{ id: "fa.makarem", name: "مکارم شیرازی" }]),
  fetchVerse: vi.fn().mockResolvedValue(null),
  fetchConcordance: vi.fn(),
  fetchStatus: vi.fn(),
}));
vi.mock("./lib/sse", () => ({ streamChat: vi.fn() }));

import App from "./App";
import { streamChat } from "./lib/sse";
import type { Evidence } from "./lib/types";
import { useStore } from "./store/useStore";

const mockStream = vi.mocked(streamChat);

const EVIDENCE: Evidence = {
  doc_id: "quran:17:23",
  ids: ["quran:17:23"],
  address: "الإسراء (17:23)",
  surah_name: "الإسراء",
  sura: 17,
  aya_start: 23,
  aya_end: 23,
  label: "Direct_Match",
  reason: "تأیید مستقیم نیکی به پدر و مادر",
  text_display: "وَقَضَىٰ رَبُّكَ أَلَّا تَعْبُدُوا إِلَّا إِيَّاهُ وَبِالْوَالِدَيْنِ إِحْسَانًا",
  translation_fa: "و پروردگارت فرمان داده که جز او را نپرستید و به پدر و مادر نیکی کنید.",
  revelation_place: "مکه",
  page: 284,
  juz: 15,
  context: { before: null, after: null },
  external_url: "https://quran.com/17/23",
  tier: 1,
  tafsir_snippet: null,
  score: 0.9,
};

function reset() {
  useStore.setState({
    messages: [],
    evidenceDict: {},
    rejectedRefs: [],
    streaming: false,
    error: null,
    deepResearch: false,
    drawer: null,
    abort: null,
    activeSessionId: null,
    cost: { prompt: 0, completion: 0 },
    byok: { provider: "openrouter", model: "", key: "test-key" },
  });
}

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  cleanup();
  reset();
  mockStream.mockReset();
  sessionStorage.clear();
});

describe("App shell", () => {
  it("renders the empty-state invitation and composer", async () => {
    render(<App />);
    expect((await screen.findAllByText("پژوهش مستند قرآن")).length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText("گزاره یا پرسش پژوهشی خود را بنویسید…")).toBeTruthy();
    expect(screen.getByText("صبر در برابر مشکلات فضیلت است.")).toBeTruthy();
  });

  it("opens BYOK settings with a masked key input", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "تنظیمات" }));
    const key = (await screen.findByLabelText("کلید API شما (BYOK)")) as HTMLInputElement;
    expect(key.type).toBe("password");
    expect(screen.getByLabelText("ارائه‌دهنده")).toBeTruthy();
  });
});

describe("grounded answer rendering", () => {
  it("renders a byte-exact citation chip + card from the evidence dictionary, never a raw REF tag", async () => {
    sessionStorage.setItem("qr_byok_key", "test-key");
    mockStream.mockImplementation(async (_p, _k, _s, onEvent) => {
      onEvent("session", { session_id: "s1" });
      onEvent("evidence_payload", EVIDENCE as unknown as Record<string, unknown>);
      onEvent("text_delta", { delta: "نیکی به والدین [[REF:quran:" });
      onEvent("text_delta", { delta: "17:23]] واجب است." });
      onEvent("done", { message_id: "m1", latency_s: 2, hops_used: 1 });
    });
    render(<App />);
    const ta = await screen.findByPlaceholderText("گزاره یا پرسش پژوهشی خود را بنویسید…");
    fireEvent.change(ta, { target: { value: "نیکی به پدر و مادر واجب است" } });
    fireEvent.click(screen.getByRole("button", { name: "ارسال" }));

    const chip = await screen.findByTitle("تأیید مستقیم — الإسراء (17:23)");
    expect(chip).toBeTruthy();
    expect(await screen.findByText(EVIDENCE.text_display)).toBeTruthy();
    expect(screen.getByText(/تأیید مستقیم نیکی به پدر و مادر/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("[[REF:");
    expect(document.body.textContent).not.toContain("استناد ردشده");
  });

  it("shows a rejected badge for a REF with no matching evidence", async () => {
    sessionStorage.setItem("qr_byok_key", "test-key");
    mockStream.mockImplementation(async (_p, _k, _s, onEvent) => {
      onEvent("session", { session_id: "s1" });
      onEvent("text_delta", { delta: "ادعا [[REF:quran:99:999]] بی‌پایه." });
      onEvent("done", { message_id: "m1", latency_s: 1, hops_used: 1 });
    });
    render(<App />);
    const ta = await screen.findByPlaceholderText("گزاره یا پرسش پژوهشی خود را بنویسید…");
    fireEvent.change(ta, { target: { value: "ادعا" } });
    fireEvent.click(screen.getByRole("button", { name: "ارسال" }));
    expect(await screen.findByText("استناد ردشده: quran:99:999")).toBeTruthy();
    expect(document.body.textContent).not.toContain("[[REF:");
  });
});