// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("./lib/api", () => ({
  fetchProviders: vi.fn().mockResolvedValue([]),
  fetchSessions: vi.fn().mockResolvedValue([]),
  fetchSessionDetail: vi.fn(),
  deleteSession: vi.fn(),
  fetchModels: vi.fn(),
  fetchTranslators: vi.fn().mockResolvedValue([]),
  fetchVerse: vi.fn(),
  fetchConcordance: vi.fn(),
  fetchStatus: vi.fn(),
}));
vi.mock("./lib/sse", () => ({ streamChat: vi.fn() }));

import App from "./App";
import { useStore } from "./store/useStore";

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

beforeEach(() => {
  vi.stubGlobal("sessionStorage", new MemStorage());
  Element.prototype.scrollIntoView = vi.fn();
  useStore.setState({
    sessions: [],
    activeSessionId: null,
    messages: [],
    evidenceDict: {},
    streaming: false,
    error: null,
    plainArabic: false,
    drawer: null,
    byok: { provider: "openrouter", model: "", key: "" },
    models: [],
    isLoadingModels: false,
    fetchStatus: null,
    fetchError: null,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("App", () => {
  it("renders the research hero with example prompts", async () => {
    render(<App />);
    expect(await screen.findByText("پژوهش مستند در قرآن کریم")).toBeTruthy();
    expect(screen.getByText("استثنای اضطرار در دروغ")).toBeTruthy();
    expect(screen.getByText("مقایسه ربا و بیع")).toBeTruthy();
    expect(screen.getByText("صبر در سختی‌ها")).toBeTruthy();
    expect(screen.getByPlaceholderText("پرسش یا گزاره پژوهشی خود را بنویسید...")).toBeTruthy();
  });

  it("has no fast/deep research toggle anywhere", async () => {
    render(<App />);
    await screen.findByText("پژوهش مستند در قرآن کریم");
    expect(screen.queryByText("حالت سریع")).toBeNull();
    expect(screen.queryByText("پژوهش عمیق")).toBeNull();
  });

  it("opens the BYOK modal when sending without a key", async () => {
    render(<App />);
    fireEvent.click(await screen.findByText("استثنای اضطرار در دروغ"));
    expect(await screen.findByText("تنظیمات کلید API و پروایدر")).toBeTruthy();
  });
});