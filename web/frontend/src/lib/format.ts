import type { Evidence } from "./types";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function citationText(e: Evidence): string {
  const aya =
    e.aya_start === e.aya_end ? `${e.sura}:${e.aya_start}` : `${e.sura}:${e.aya_start}-${e.aya_end}`;
  return `«${e.text_display}»\n${e.surah_name} (${aya})\n${e.external_url}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function formatSeconds(s: unknown): string {
  const n = typeof s === "number" ? s : Number(s);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(1)} ثانیه`;
}