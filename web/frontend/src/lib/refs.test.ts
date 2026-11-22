import { describe, expect, it } from "vitest";
import { RefStreamParser, appendSegments, parseFull, segmentsToText } from "./refs";
import type { Segment } from "../types";

function refText(segments: Segment[]): string {
  return segments.map((s) => (s.type === "text" ? s.text : "")).join("");
}

describe("RefStreamParser", () => {
  it("buffers a tag split across two packets without flashing raw text", () => {
    const p = new RefStreamParser();
    const a = p.push("متن [[REF:quran:");
    expect(a).toEqual([{ type: "text", text: "متن " }]);
    expect(refText(a)).not.toContain("[[REF:");
    const b = p.push("17:23]] ادامه");
    expect(b).toEqual([
      { type: "ref", docId: "quran:17:23" },
      { type: "text", text: " ادامه" },
    ]);
    expect(p.flush()).toEqual([]);
  });

  it("buffers a tag split character by character", () => {
    const p = new RefStreamParser();
    const full = "الف [[REF:quran:2:255]] ب";
    const collected: Segment[] = [];
    for (const ch of full) {
      const segs = p.push(ch);
      expect(refText(segs)).not.toContain("[");
      collected.push(...segs);
    }
    collected.push(...p.flush());
    expect(collected.filter((s) => s.type === "ref")).toEqual([
      { type: "ref", docId: "quran:2:255" },
    ]);
    expect(segmentsToText(collected)).toBe(full);
  });

  it("never emits a partial opener as text mid-stream", () => {
    const p = new RefStreamParser();
    for (const delta of ["x ", "[", "[", "R", "E", "F", ":", "quran:1:1", "]", "]"]) {
      const segs = p.push(delta);
      expect(refText(segs)).not.toContain("[");
    }
  });

  it("emits a lone bracket as text once it cannot be a tag", () => {
    const p = new RefStreamParser();
    const segs = [...p.push("a [ b"), ...p.flush()];
    expect(segmentsToText(segs)).toBe("a [ b");
  });

  it("handles multiple refs in one packet", () => {
    const segs = parseFull("[[REF:quran:1:1]] و [[REF:quran:2:2]]");
    expect(segs).toEqual([
      { type: "ref", docId: "quran:1:1" },
      { type: "text", text: " و " },
      { type: "ref", docId: "quran:2:2" },
    ]);
  });

  it("flush emits an incomplete tag as plain text", () => {
    const p = new RefStreamParser();
    p.push("پاسخ [[REF:quran:2");
    const segs = p.flush();
    expect(segmentsToText(segs)).toBe("[[REF:quran:2");
  });

  it("round-trips prose with refs", () => {
    const text = "صبر [[REF:quran:2:153]] فضیلت است [[REF:quran:3:200]].";
    expect(segmentsToText(parseFull(text))).toBe(text);
  });

  it("trims whitespace inside the tag", () => {
    expect(parseFull("[[REF: quran:2:255 ]]")).toEqual([
      { type: "ref", docId: "quran:2:255" },
    ]);
  });
});

describe("appendSegments", () => {
  it("merges adjacent text packets so words are never split into paragraphs", () => {
    const segs = appendSegments(
      [{ type: "text", text: "هی" }],
      [{ type: "text", text: "چ یک از این آیات" }]
    );
    expect(segs).toEqual([{ type: "text", text: "هیچ یک از این آیات" }]);
  });

  it("keeps refs as boundaries between text runs", () => {
    const segs = appendSegments(
      [{ type: "text", text: "متن " }],
      [
        { type: "ref", docId: "quran:2:255" },
        { type: "text", text: " ادامه" },
      ]
    );
    expect(segs).toEqual([
      { type: "text", text: "متن " },
      { type: "ref", docId: "quran:2:255" },
      { type: "text", text: " ادامه" },
    ]);
  });

  it("drops empty text packets", () => {
    expect(appendSegments([], [{ type: "text", text: "" }])).toEqual([]);
  });
});