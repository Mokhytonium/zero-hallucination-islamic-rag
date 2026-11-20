import { describe, expect, it } from "vitest";
import { displayArabic, stripDiacritics } from "./arabic";
import { citationText, cx, formatSeconds } from "./format";
import { labelStyle } from "./labels";
import type { Evidence } from "./types";

describe("arabic diacritics", () => {
  it("strips tashkeel but keeps letters", () => {
    expect(stripDiacritics("بِسْمِ اللَّهِ")).toBe("بسم الله");
  });
  it("displayArabic respects the toggle", () => {
    expect(displayArabic("الرَّحْمَٰنِ", true)).toBe("الرَّحْمَٰنِ");
    expect(displayArabic("الرَّحْمَٰنِ", false)).toBe("الرحمن");
  });
});

describe("labelStyle", () => {
  it("maps known labels to their section", () => {
    expect(labelStyle("Direct_Match").section).toBe("main");
    expect(labelStyle("Contradiction").section).toBe("opposing");
  });
  it("falls back to unverified for unknown labels", () => {
    expect(labelStyle("Bogus").section).toBe("unverified");
    expect(labelStyle(undefined).section).toBe("unverified");
  });
});

describe("format helpers", () => {
  it("cx joins truthy class names", () => {
    expect(cx("a", false, "b", null, undefined)).toBe("a b");
  });
  it("formatSeconds handles numbers and junk", () => {
    expect(formatSeconds(1.5)).toBe("1.5 ثانیه");
    expect(formatSeconds("x")).toBe("—");
  });
  it("citationText includes verse, address and url", () => {
    const e = {
      text_display: "اللَّهُ",
      surah_name: "بقره",
      sura: 2,
      aya_start: 255,
      aya_end: 255,
      external_url: "https://quran.com/2/255",
    } as Evidence;
    const t = citationText(e);
    expect(t).toContain("«اللَّهُ»");
    expect(t).toContain("بقره (2:255)");
    expect(t).toContain("https://quran.com/2/255");
  });
});