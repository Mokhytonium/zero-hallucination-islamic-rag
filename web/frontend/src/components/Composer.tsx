import { useEffect, useRef } from "react";
import { cx } from "../lib/format";
import { useStore } from "../store/useStore";
import { Icon } from "./Icon";

const MAX = 5000;

export function Composer({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const send = useStore((s) => s.send);
  const cancel = useStore((s) => s.cancel);
  const streaming = useStore((s) => s.streaming);
  const deep = useStore((s) => s.deepResearch);
  const toggleDeep = useStore((s) => s.toggleDeep);
  const cost = useStore((s) => s.cost);
  const hasKey = useStore((s) => Boolean(s.byok.key));
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  const submit = () => {
    const text = value.trim();
    if (!text || streaming) return;
    onChange("");
    void send(text);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="border-t border-line bg-surface px-4 py-3 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-line bg-subtle p-0.5 text-xs">
            <button
              type="button"
              onClick={() => deep && toggleDeep()}
              className={cx(
                "rounded-md px-2.5 py-1 font-medium transition-colors",
                !deep ? "bg-surface text-green shadow-sm" : "text-secondary hover:text-ink"
              )}
            >
              حالت سریع
            </button>
            <button
              type="button"
              onClick={() => !deep && toggleDeep()}
              className={cx(
                "rounded-md px-2.5 py-1 font-medium transition-colors",
                deep ? "bg-surface text-amber shadow-sm" : "text-secondary hover:text-ink"
              )}
            >
              پژوهش عمیق
            </button>
          </div>
          <span className="text-[11px] text-muted">
            {deep
              ? "reranker سنگین فعال · حدود ۸۰ ثانیه روی CPU"
              : "بدون reranker · پاسخ زیر ۵–۸ ثانیه"}
          </span>
          {streaming && deep && (
            <span className="flex items-center gap-1 rounded-full bg-amber-bg px-2 py-0.5 text-[11px] text-amber">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber" />
              در حال پژوهش عمیق
            </span>
          )}
          {(cost.prompt > 0 || cost.completion > 0) && (
            <span className="ms-auto text-[11px] text-muted" title="توکن‌های مصرف‌شده">
              توکن: {cost.prompt}↑ {cost.completion}↓
            </span>
          )}
        </div>

        {!hasKey && (
          <p className="mb-2 rounded-lg bg-amber-bg px-3 py-1.5 text-xs text-amber">
            برای اجرای پژوهش، کلید API خود را در تنظیمات وارد کنید (BYOK).
          </p>
        )}

        <div className="flex items-end gap-2 rounded-2xl border border-line bg-page p-2 focus-within:border-focus">
          <textarea
            ref={ta}
            rows={1}
            value={value}
            maxLength={MAX}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="گزاره یا پرسش پژوهشی خود را بنویسید…"
            className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] leading-7 text-ink outline-none placeholder:text-muted"
          />
          {streaming ? (
            <button
              type="button"
              onClick={cancel}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-bg text-rose transition-colors hover:bg-rose hover:text-white"
              title="لغو پژوهش"
              aria-label="لغو پژوهش"
            >
              <Icon name="stop" className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!value.trim()}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-green text-white transition-colors hover:bg-dark disabled:cursor-not-allowed disabled:bg-line disabled:text-muted"
              title="ارسال"
              aria-label="ارسال"
            >
              <Icon name="send" className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="mt-1 flex justify-between px-1 text-[11px] text-muted">
          <span>Enter برای ارسال · Shift+Enter برای خط جدید</span>
          <span>
            {value.length}/{MAX}
          </span>
        </div>
      </div>
    </div>
  );
}