import { useEffect, useState } from "react";
import {
  fetchConcordance,
  fetchTranslators,
  fetchVerse,
  type ConcordanceResponse,
  type VerseResponse,
} from "../lib/api";
import { displayArabic } from "../lib/arabic";
import { cx } from "../lib/format";
import { labelStyle } from "../lib/labels";
import type { VerseView } from "../lib/types";
import { useStore } from "../store/useStore";
import { Icon } from "./Icon";
import { TafsirSlot } from "./InlineCitationCard";

function ContextVerse({ v, label }: { v: VerseView | null; label: string }) {
  const diacritics = useStore((s) => s.diacritics);
  if (!v) return null;
  return (
    <div className="rounded-lg border border-line bg-page p-3">
      <p className="mb-1 text-[11px] font-medium text-muted">
        {label} · {v.address}
      </p>
      <p className="quran-text text-lg text-ink" dir="rtl" lang="ar">
        {displayArabic(v.text_display, diacritics)}
      </p>
      {v.translation_fa && <p className="mt-1 text-xs leading-6 text-secondary">{v.translation_fa}</p>}
    </div>
  );
}

export function EvidenceDrawer() {
  const drawer = useStore((s) => s.drawer);
  const closeDrawer = useStore((s) => s.closeDrawer);
  const diacritics = useStore((s) => s.diacritics);
  const toggleDiacritics = useStore((s) => s.toggleDiacritics);

  const [verse, setVerse] = useState<VerseResponse | null>(null);
  const [translators, setTranslators] = useState<{ id: string; name: string }[]>([]);
  const [translator, setTranslator] = useState("");
  const [activeWord, setActiveWord] = useState<string | null>(null);
  const [concordance, setConcordance] = useState<ConcordanceResponse | null>(null);

  const docId = drawer?.doc_id;

  useEffect(() => {
    setVerse(null);
    setTranslator("");
    setActiveWord(null);
    setConcordance(null);
    if (!drawer) return;
    let alive = true;
    fetchTranslators()
      .then((t) => alive && setTranslators(t))
      .catch(() => {});
    fetchVerse(drawer.ids)
      .then((v) => alive && setVerse(v))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [docId]);

  useEffect(() => {
    if (!activeWord) {
      setConcordance(null);
      return;
    }
    let alive = true;
    fetchConcordance(activeWord)
      .then((c) => alive && setConcordance(c))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [activeWord]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeDrawer();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeDrawer]);

  if (!drawer) return null;
  const st = labelStyle(drawer.label);
  const aya =
    drawer.aya_start === drawer.aya_end
      ? `${drawer.sura}:${drawer.aya_start}`
      : `${drawer.sura}:${drawer.aya_start}-${drawer.aya_end}`;
  const translation =
    (translator && verse?.translations[translator]) || drawer.translation_fa;
  const words = Array.from(new Set((verse?.words ?? []).map((w) => w.word))).slice(0, 60);

  return (
    <div className="fixed inset-0 z-40">
      <div className="fade-in absolute inset-0 bg-ink/30" onClick={closeDrawer} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="کشوی شواهد"
        className="drawer-in absolute inset-y-0 left-0 flex w-full flex-col border-r border-line bg-surface sm:w-[440px]"
      >
        <header className="flex items-start gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className={cx("rounded-full px-2 py-0.5 text-[11px] font-medium", st.chip)}>
                {st.name}
              </span>
              <span className="rounded bg-subtle px-1.5 py-0.5 text-[11px] text-muted">
                درجه {drawer.tier} · قرآن
              </span>
            </div>
            <h3 className="text-base font-semibold text-ink">
              {drawer.surah_name} <span className="text-secondary">({aya})</span>
            </h3>
            {verse?.surah_name_en && (
              <p className="text-[11px] text-muted">{verse.surah_name_en}</p>
            )}
          </div>
          <a
            href={drawer.external_url}
            target="_blank"
            rel="noreferrer noopener"
            className="flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs text-secondary hover:bg-subtle hover:text-ink"
          >
            quran.com <Icon name="external" className="h-3.5 w-3.5" />
          </a>
          <button
            type="button"
            onClick={closeDrawer}
            className="rounded p-1.5 text-secondary hover:bg-subtle hover:text-ink"
            aria-label="بستن کشو"
          >
            <Icon name="close" className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-xs font-medium text-muted">متن آیه</h4>
              <button
                type="button"
                onClick={toggleDiacritics}
                className={cx(
                  "rounded-md px-2 py-0.5 text-[11px] transition-colors",
                  diacritics ? "bg-green-bg text-green" : "bg-subtle text-secondary"
                )}
              >
                {diacritics ? "اعراب: روشن" : "اعراب: خاموش"}
              </button>
            </div>
            <p className="quran-text rounded-xl bg-page p-3 text-2xl text-ink" dir="rtl" lang="ar">
              {displayArabic(drawer.text_display, diacritics)}
            </p>
          </section>

          <section>
            <div className="mb-2 flex items-center gap-2">
              <h4 className="text-xs font-medium text-muted">ترجمه</h4>
              <select
                value={translator}
                onChange={(e) => setTranslator(e.target.value)}
                className="ms-auto rounded-md border border-line bg-page px-2 py-1 text-[11px] text-ink outline-none focus:border-focus"
                aria-label="انتخاب مترجم"
              >
                <option value="">مترجم پیش‌فرض</option>
                {translators.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-sm leading-7 text-secondary">{translation || "—"}</p>
          </section>

          {drawer.reason && (
            <section>
              <h4 className="mb-1 text-xs font-medium text-muted">نقش در استدلال</h4>
              <p className="text-sm leading-7 text-secondary">{drawer.reason}</p>
            </section>
          )}

          <section>
            <h4 className="mb-2 text-xs font-medium text-muted">آیات همسایه</h4>
            <div className="space-y-2">
              <ContextVerse v={drawer.context.before} label="پیشین" />
              <ContextVerse v={drawer.context.after} label="پسین" />
              {!drawer.context.before && !drawer.context.after && (
                <p className="text-xs text-muted">همسایه‌ای ثبت نشده است.</p>
              )}
            </div>
          </section>

          <section>
            <h4 className="mb-2 text-xs font-medium text-muted">تحلیل واژه</h4>
            {words.length === 0 && <p className="text-xs text-muted">در حال بارگذاری واژه‌ها…</p>}
            <div className="flex flex-wrap gap-1.5">
              {words.map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setActiveWord(w === activeWord ? null : w)}
                  className={cx(
                    "quran-text rounded-md border px-2 py-0.5 text-base transition-colors",
                    activeWord === w
                      ? "border-indigo bg-indigo-bg text-indigo"
                      : "border-line bg-page text-ink hover:border-focus"
                  )}
                  dir="rtl"
                  lang="ar"
                >
                  {displayArabic(w, diacritics)}
                </button>
              ))}
            </div>
            {concordance && (
              <div className="mt-2 rounded-lg bg-indigo-bg p-3 text-sm text-indigo">
                <p className="mb-1 font-medium">
                  «{concordance.word}» — {concordance.count} بار در قرآن
                </p>
                <ul className="space-y-0.5 text-xs">
                  {concordance.samples.map((s) => (
                    <li key={s.id}>{s.address}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section>
            <h4 className="mb-2 text-xs font-medium text-muted">تفسیر</h4>
            <TafsirSlot snippet={drawer.tafsir_snippet} />
          </section>
        </div>

        <footer className="flex flex-wrap gap-x-3 gap-y-1 border-t border-line px-4 py-2.5 text-[11px] text-muted">
          {drawer.page != null && <span>صفحه {drawer.page}</span>}
          {drawer.juz != null && <span>جزء {drawer.juz}</span>}
          {drawer.revelation_place && <span>{drawer.revelation_place}</span>}
          <span className="ms-auto">متن بایت‌دقیق از پایگاه‌داده</span>
        </footer>
      </aside>
    </div>
  );
}