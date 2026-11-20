import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { displayArabic } from "../lib/arabic";
import { cx } from "../lib/format";
import { labelStyle } from "../lib/labels";
import type { Evidence } from "../lib/types";
import { useStore } from "../store/useStore";
import { Icon } from "./Icon";
import { TafsirSlot } from "./InlineCitationCard";

const WIDTH = 320;

interface Pos {
  left: number;
  top?: number;
  bottom?: number;
}

export function CitationChip({ evidence }: { evidence: Evidence }) {
  const diacritics = useStore((s) => s.diacritics);
  const openDrawer = useStore((s) => s.openDrawer);
  const ref = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | null>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const st = labelStyle(evidence.label);
  const aya =
    evidence.aya_start === evidence.aya_end
      ? `${evidence.sura}:${evidence.aya_start}`
      : `${evidence.sura}:${evidence.aya_start}-${evidence.aya_end}`;

  const clearTimer = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const show = () => {
    clearTimer();
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.min(Math.max(8, r.left + r.width / 2 - WIDTH / 2), window.innerWidth - WIDTH - 8);
    setPos(r.top > 280 ? { left, bottom: window.innerHeight - r.top + 8 } : { left, top: r.bottom + 8 });
  };

  const hide = () => {
    clearTimer();
    timer.current = window.setTimeout(() => setPos(null), 140);
  };

  useEffect(() => () => clearTimer(), []);

  return (
    <>
      <button
        ref={ref}
        type="button"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={() => openDrawer(evidence)}
        className={cx(
          "mx-0.5 inline-flex translate-y-[-1px] items-center gap-1 rounded-md border px-1.5 py-0.5",
          "align-baseline text-[13px] font-medium transition-colors",
          st.chip,
          "border-line hover:border-focus"
        )}
        title={`${st.name} — ${evidence.surah_name} (${aya})`}
      >
        <span className={cx("h-1.5 w-1.5 rounded-full", st.spine)} aria-hidden="true" />
        {evidence.surah_name} {aya}
      </button>
      {pos &&
        createPortal(
          <div
            role="tooltip"
            onMouseEnter={clearTimer}
            onMouseLeave={hide}
            style={{ position: "fixed", left: pos.left, top: pos.top, bottom: pos.bottom, width: WIDTH }}
            className="z-50 rounded-xl border border-line bg-surface p-3 shadow-[0_8px_30px_rgba(39,41,50,0.16)]"
          >
            <div className="mb-1.5 flex items-center gap-2">
              <span className={cx("rounded-full px-2 py-0.5 text-[11px] font-medium", st.chip)}>
                {st.name}
              </span>
              <span className="text-xs font-semibold text-ink">
                {evidence.surah_name} ({aya})
              </span>
              <a
                href={evidence.external_url}
                target="_blank"
                rel="noreferrer noopener"
                className="ms-auto text-secondary hover:text-ink"
                title="quran.com"
              >
                <Icon name="external" className="h-3.5 w-3.5" />
              </a>
            </div>
            <p className="quran-text mb-1.5 text-lg leading-9 text-ink" dir="rtl" lang="ar">
              {displayArabic(evidence.text_display, diacritics)}
            </p>
            {evidence.translation_fa && (
              <p className="mb-1.5 line-clamp-3 text-xs leading-6 text-secondary">
                {evidence.translation_fa}
              </p>
            )}
            {evidence.reason && (
              <p className="mb-1.5 text-xs leading-6 text-secondary">
                <span className="font-medium text-ink">نقش در استدلال: </span>
                {evidence.reason}
              </p>
            )}
            <TafsirSlot snippet={evidence.tafsir_snippet} />
          </div>,
          document.body
        )}
    </>
  );
}

export function RejectedRef({ docId }: { docId: string }) {
  return (
    <span
      className="mx-0.5 inline-flex items-center gap-1 rounded-md border border-dashed border-rose/40 bg-rose-bg px-1.5 py-0.5 align-baseline text-[12px] text-rose"
      title="این استناد در شواهد تأییدشده یافت نشد و رندر نشد."
    >
      <Icon name="close" className="h-3 w-3" />
      استناد ردشده: {docId}
    </span>
  );
}