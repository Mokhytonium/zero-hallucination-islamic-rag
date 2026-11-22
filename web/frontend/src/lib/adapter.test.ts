import { describe, expect, it } from "vitest";
import { toVerifiedVerse } from "./adapter";
import { stripDiacritics } from "./arabic";
import type { Evidence } from "../types";

const base: Evidence = {
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
  rrf_score: 0.03,
  rerank_score: 2.0,
  signals: { semantic: 0.72, lexical: 0.41 },
  text_display: "اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ",
  translation_fa: "خداوندی جز او نیست",
  revelation_place: "Medinan",
  page: 42,
  juz: 3,
  context: {
    before: { id: "quran:2:254", address: "البقرة (2:254)", text_display: "پیشین", translation_fa: "ترجمه پیشین" },
    after: null,
  },
  external_url: "https://quran.com/2/255",
  tier: 1,
  tafsir_snippet: null,
};

describe("toVerifiedVerse", () => {
  it("maps confidence from the reranker logit through a sigmoid", () => {
    const v = toVerifiedVerse(base);
    expect(v.confidence).toBe(Math.round((1 / (1 + Math.exp(-2.0))) * 100));
    expect(v.confidence).toBe(88);
  });

  it("falls back to score when rerank_score is null", () => {
    const v = toVerifiedVerse({ ...base, rerank_score: null });
    expect(v.confidence).toBe(Math.round((1 / (1 + Math.exp(-0.8))) * 100));
  });

  it("translates revelation place and exposes the makarem translation", () => {
    const v = toVerifiedVerse(base);
    expect(v.revelation_place).toBe("مدنی");
    expect(v.translations.makarem).toBe("خداوندی جز او نیست");
    expect(v.translations["fa.makarem"]).toBe("خداوندی جز او نیست");
  });

  it("converts signal fractions to whole percentages", () => {
    const v = toVerifiedVerse(base);
    expect(v.signals.semantic).toBe(72);
    expect(v.signals.lexical).toBe(41);
  });

  it("strips diacritics for text_plain but keeps text_display byte-exact", () => {
    const v = toVerifiedVerse(base);
    expect(v.text_display).toBe(base.text_display);
    expect(v.text_plain).toBe(stripDiacritics(base.text_display));
    expect(v.text_plain).not.toBe(v.text_display);
  });

  it("adapts context verses and preserves null neighbours", () => {
    const v = toVerifiedVerse(base);
    expect(v.context.before).toEqual({ aya: 254, arabic: "پیشین", translation: "ترجمه پیشین" });
    expect(v.context.after).toBeNull();
    expect(v.aya).toBe(255);
  });

  it("guards an unknown label to Direct_Match", () => {
    const v = toVerifiedVerse({ ...base, label: "Unverified" });
    expect(v.label).toBe("Direct_Match");
  });

  it("keeps a Conditional_Match label intact", () => {
    expect(toVerifiedVerse({ ...base, label: "Conditional_Match" }).label).toBe("Conditional_Match");
  });
});