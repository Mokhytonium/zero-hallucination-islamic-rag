import { describe, expect, it } from "vitest";
import { formatLatency, relativeTime, toPersianDigits } from "./format";

describe("format helpers", () => {
  it("converts digits and latency to Persian", () => {
    expect(toPersianDigits(2024)).toBe("۲۰۲۴");
    expect(formatLatency(3.42)).toBe("۳٫۴ ثانیه");
  });

  it("renders Persian relative timestamps", () => {
    const now = Date.now();
    expect(relativeTime(new Date(now - 30_000).toISOString())).toBe("همین حالا");
    expect(relativeTime(new Date(now - 5 * 60_000).toISOString())).toBe("۵ دقیقه پیش");
    expect(relativeTime(new Date(now - 3 * 3_600_000).toISOString())).toBe("۳ ساعت پیش");
    expect(relativeTime(new Date(now - 2 * 86_400_000).toISOString())).toBe("۲ روز پیش");
  });

  it("returns an empty string for missing or invalid timestamps", () => {
    expect(relativeTime(null)).toBe("");
    expect(relativeTime(undefined)).toBe("");
    expect(relativeTime("not-a-date")).toBe("");
  });
});
