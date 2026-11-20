import { useState } from "react";
import { displayArabic } from "../lib/arabic";
import { citationText, copyText, cx } from "../lib/format";
import { labelStyle } from "../lib/labels";
import type { Evidence } from "../lib/types";
import { useStore } from "../store/useStore";
import { Icon } from "./Icon";

export function TafsirSlot({ snippet }: { snippet?: string | null }) {
  if (snippet) {
    return (
      <div className="rounded-lg bg-subtle px-3 py-2 text-sm text-secondary">
        <span className="mb-1 block text-xs font-medium text-muted">تفسیر</span>
        {snippet}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-line px-3 py-2 text-xs text-muted">
      <Icon name="book" className="h-3.5 w-3.5" />
      <span>تفسیر: به‌زودی — منبع تفسیر هنوز ثبت نشده است.</span>
    </div>
  );
}

export function InlineCitationCard({ evidence }: { evidence: Evidence }) {
  const diacritics = useStore((s) => s.diacritics);
  const openDrawer = useStore((s) => s.openDrawer);
  const [copied, setCopied] = useState(false);
  const st = labelStyle(evidence.label);
  const aya =
    evidence.aya_start === evidence.aya_end
      ? `${evidence.sura}:${evidence.aya_start}`
      : `${evidence.sura}:${evidence.aya_start}-${evidence.aya_end}`;

  const onCopy = async () => {
    const ok = await copyText(citationText(evidence));
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  };

  return (
    <article
      className={cx(
        "relative overflow-hidden rounded-xl border border-line bg-surface",
        "shadow-[0_1px_2px_rgba(39,41,50,0.04)] transition-shadow hover:shadow-[0_2px_10px_rgba(39,41,50,0.07)]"
      )}
    >
      <span className={cx("absolute inset-y-0 right-0 w-1", st.spine)} aria-hidden="true" />
      <div className="py-3 pl-3 pr-4">
        <header className="mb-2 flex flex-wrap items-center gap-2">
          <span className={cx("rounded-full px-2 py-0.5 text-xs font-medium", st.chip)}>
            {st.name}
          </span>
          <button
            type="button"
            onClick={() => openDrawer(evidence)}
            className="text-sm font-semibold text-ink hover:text-dark"
            title="گشودن کشوی شواهد"
          >
            {evidence.surah_name} <span className="text-secondary">({aya})</span>
          </button>
          <span className="rounded bg-subtle px-1.5 py-0.5 text-[11px] text-muted">
            درجه {evidence.tier}
          </span>
          <span className="ms-auto flex items-center gap-1">
            <a
              href={evidence.external_url}
              target="_blank"
              rel="noreferrer noopener"
              className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-secondary hover:bg-subtle hover:text-ink"
              title="گشودن در quran.com"
            >
              quran.com <Icon name="external" className="h-3.5 w-3.5" />
            </a>
            <button
              type="button"
              onClick={onCopy}
              className="rounded p-1.5 text-secondary hover:bg-subtle hover:text-ink"
              title="کپی استناد"
              aria-label="کپی استناد"
            >
              <Icon name={copied ? "check" : "copy"} className={cx("h-4 w-4", copied && "text-green")} />
            </button>
          </span>
        </header>

        <p className="quran-text mb-2 text-xl text-ink" dir="rtl" lang="ar">
          {displayArabic(evidence.text_display, diacritics)}
        </p>
        {evidence.translation_fa && (
          <p className="mb-2 text-sm leading-7 text-secondary">{evidence.translation_fa}</p>
        )}

        {evidence.reason && (
          <div className="mb-2 flex gap-2 text-sm text-secondary">
            <Icon name="quote" className={cx("mt-0.5 h-4 w-4 shrink-0", st.accent)} />
            <p>
              <span className="font-medium text-ink">نقش در استدلال: </span>
              {evidence.reason}
            </p>
          </div>
        )}

        <TafsirSlot snippet={evidence.tafsir_snippet} />

        <footer className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
          {evidence.page != null && <span>صفحه {evidence.page}</span>}
          {evidence.juz != null && <span>جزء {evidence.juz}</span>}
          {evidence.revelation_place && <span>{evidence.revelation_place}</span>}
          {evidence.score != null && <span>امتیاز {evidence.score}</span>}
        </footer>
      </div>
    </article>
  );
}