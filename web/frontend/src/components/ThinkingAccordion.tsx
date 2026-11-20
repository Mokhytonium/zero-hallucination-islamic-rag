import { useEffect, useState } from "react";
import { cx } from "../lib/format";
import type { ThinkingStep } from "../lib/types";
import { Icon } from "./Icon";

const PHASE_FA: Record<string, string> = {
  planning: "طراحی پژوهش",
  retrieval: "بازیابی",
  gap: "پرکردن شکاف",
  counter: "شاهد مخالف",
  chain: "زنجیره‌ی استناد",
  final: "مرحله‌ی نهایی",
  judging: "داوری",
  reasoning: "استدلال",
};

export function ThinkingAccordion({
  trace,
  streaming,
}: {
  trace: ThinkingStep[];
  streaming?: boolean;
}) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (!streaming) setOpen(false);
  }, [streaming]);

  if (!trace.length) return null;
  const hops = Math.max(...trace.map((t) => t.hop));

  return (
    <div className="mb-3 rounded-xl border border-line bg-subtle/60">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-secondary hover:text-ink"
      >
        <Icon name="spark" className={cx("h-4 w-4", streaming ? "text-amber" : "text-indigo")} />
        <span className="font-medium text-ink">مسیر پژوهش</span>
        <span className="text-xs text-muted">
          {trace.length} گام · {hops} hop
        </span>
        {streaming && (
          <span className="flex items-center gap-1 text-xs text-amber">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber" />
            در حال پژوهش
          </span>
        )}
        <Icon
          name="chevron"
          className={cx("ms-auto h-4 w-4 transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <ol className="space-y-2 border-t border-line px-3 py-2">
          {trace.map((t, i) => (
            <li key={i} className="flex gap-2 text-sm">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface text-[11px] font-medium text-secondary ring-1 ring-line">
                {t.hop}
              </span>
              <div className="min-w-0">
                <p className="text-ink">
                  {t.title}
                  {t.phase && (
                    <span className="ms-2 rounded bg-surface px-1.5 py-0.5 text-[11px] text-muted ring-1 ring-line">
                      {PHASE_FA[t.phase] ?? t.phase}
                    </span>
                  )}
                </p>
                {t.detail && <p className="text-xs leading-6 text-secondary">{t.detail}</p>}
                {t.queries && t.queries.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {t.queries.map((q, j) => (
                      <span
                        key={j}
                        className="rounded-md bg-surface px-2 py-0.5 text-[11px] text-secondary ring-1 ring-line"
                      >
                        {q}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}