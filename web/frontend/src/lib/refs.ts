import type { Segment } from "./types";

const OPEN = "[[REF:";
const CLOSE = "]]";

/**
 * Incremental parser for [[REF:doc_id]] tags in a streamed answer.
 * A tag may arrive split across several SSE packets; the parser holds back any
 * trailing partial tag so a raw "[[REF:" never flashes on screen. Plain Persian
 * prose is emitted immediately. Call flush() at end of stream.
 */
export class RefStreamParser {
  private buffer = "";

  push(delta: string): Segment[] {
    this.buffer += delta;
    return this.drain(false);
  }

  flush(): Segment[] {
    return this.drain(true);
  }

  private drain(final: boolean): Segment[] {
    const out: Segment[] = [];
    for (;;) {
      const idx = this.buffer.indexOf(OPEN);
      if (idx === -1) {
        const hold = final ? 0 : this.partialOpenSuffix();
        const text = this.buffer.slice(0, this.buffer.length - hold);
        if (text) out.push({ type: "text", text });
        this.buffer = hold ? this.buffer.slice(this.buffer.length - hold) : "";
        break;
      }
      if (idx > 0) {
        out.push({ type: "text", text: this.buffer.slice(0, idx) });
        this.buffer = this.buffer.slice(idx);
      }
      const end = this.buffer.indexOf(CLOSE, OPEN.length);
      if (end === -1) {
        if (final) {
          out.push({ type: "text", text: this.buffer });
          this.buffer = "";
        }
        break;
      }
      const docId = this.buffer.slice(OPEN.length, end).trim();
      out.push({ type: "ref", docId });
      this.buffer = this.buffer.slice(end + CLOSE.length);
    }
    return out;
  }

  private partialOpenSuffix(): number {
    const b = this.buffer;
    const max = Math.min(b.length, OPEN.length - 1);
    for (let n = max; n >= 1; n--) {
      if (OPEN.startsWith(b.slice(b.length - n))) return n;
    }
    return 0;
  }
}

export function parseFull(text: string): Segment[] {
  const p = new RefStreamParser();
  return [...p.push(text), ...p.flush()];
}

export function segmentsToText(segments: Segment[]): string {
  return segments
    .map((s) => (s.type === "text" ? s.text : `[[REF:${s.docId}]]`))
    .join("");
}