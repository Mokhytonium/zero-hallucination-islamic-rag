export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* permission denied or non-secure origin — use the legacy fallback below */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

const PERSIAN_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

export function toPersianDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)]);
}

export function formatSeconds(s: unknown): string {
  const n = typeof s === "number" ? s : Number(s);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(1)} ثانیه`;
}

export function formatLatency(s: unknown): string {
  const n = typeof s === "number" ? s : Number(s);
  if (!Number.isFinite(n)) return "—";
  return `${toPersianDigits(n.toFixed(1)).replace(".", "٫")} ثانیه`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Compact Persian relative timestamp for the conversation list. */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const diff = Math.max(0, Date.now() - then);
  if (diff < MINUTE) return "همین حالا";
  if (diff < HOUR) return `${toPersianDigits(Math.floor(diff / MINUTE))} دقیقه پیش`;
  if (diff < DAY) return `${toPersianDigits(Math.floor(diff / HOUR))} ساعت پیش`;
  if (diff < 7 * DAY) return `${toPersianDigits(Math.floor(diff / DAY))} روز پیش`;
  if (diff < 30 * DAY) return `${toPersianDigits(Math.floor(diff / (7 * DAY)))} هفته پیش`;
  return `${toPersianDigits(Math.floor(diff / (30 * DAY)))} ماه پیش`;
}