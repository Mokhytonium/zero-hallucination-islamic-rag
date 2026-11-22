import { useEffect, useState } from "react";
import { X, ArrowUpLeft } from "lucide-react";
import {
  fetchConcordance,
  fetchTranslators,
  fetchVerse,
} from "../lib/api";
import { stripDiacritics } from "../lib/arabic";
import { toPersianDigits } from "../lib/format";
import { useDialogA11y } from "../lib/useDialogA11y";
import { usePresence } from "../lib/usePresence";
import type { ConcordanceResponse, VerifiedVerse, VerseResponse } from "../types";

interface Props {
  verse: VerifiedVerse | null;
  plainArabic: boolean;
  onClose: () => void;
}

interface ContextView {
  aya: number;
  arabic: string;
  translation: string;
}

function ayaFromId(id: string): number {
  const parts = id.split(":");
  const n = Number(parts[parts.length - 1]);
  return Number.isFinite(n) ? n : 0;
}

export function EvidenceDrawer({ verse: verseProp, plainArabic, onClose }: Props) {
  const [translators, setTranslators] = useState<{ id: string; name: string }[]>([]);
  const [translator, setTranslator] = useState("");
  const [full, setFull] = useState<VerseResponse | null>(null);
  const [activeWord, setActiveWord] = useState<string | null>(null);
  const [concordance, setConcordance] = useState<ConcordanceResponse | null>(null);
  const [snapshot, setSnapshot] = useState<VerifiedVerse | null>(null);
  const { mounted, closing } = usePresence(Boolean(verseProp));
  const dialogRef = useDialogA11y<HTMLDivElement>(Boolean(verseProp) && mounted, onClose);

  // Keep the last verse while the drawer animates out; the parent clears the
  // `verse` prop immediately, which used to unmount the panel before its exit
  // animation could run.
  useEffect(() => {
    if (verseProp) setSnapshot(verseProp);
  }, [verseProp]);

  const verse = verseProp ?? snapshot;
  const docId = verse?.doc_id;

  useEffect(() => {
    setFull(null);
    setActiveWord(null);
    setConcordance(null);
    if (!verse) return;
    let alive = true;
    fetchTranslators()
      .then((t) => {
        if (!alive) return;
        setTranslators(t);
        setTranslator((cur) => cur || t[0]?.id || "fa.makarem");
      })
      .catch(() => {});
    fetchVerse(verse.ids)
      .then((v) => alive && setFull(v))
      .catch(() => {});
    return () => {
      alive = false;
    };
    // `docId` identifies the verse; `verse` is kept in a ref-like snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  if (!mounted || !verse) return null;

  const arabic = (t: string) => (plainArabic ? stripDiacritics(t) : t);
  const translation =
    (translator && full?.translations[translator]) ||
    verse.translations[translator] ||
    verse.translations.makarem ||
    "";

  const before: ContextView | null = full?.before
    ? {
        aya: ayaFromId(full.before.id),
        arabic: full.before.text_display,
        translation: full.before.translations[translator] || Object.values(full.before.translations)[0] || "",
      }
    : verse.context.before;
  const after: ContextView | null = full?.after
    ? {
        aya: ayaFromId(full.after.id),
        arabic: full.after.text_display,
        translation: full.after.translations[translator] || Object.values(full.after.translations)[0] || "",
      }
    : verse.context.after;

  const words = Array.from(new Set((full?.words ?? []).map((w) => w.word))).slice(0, 60);

  const contextCard = (c: ContextView | null, label: string) =>
    c ? (
      <div className="p-3.5 rounded-xl bg-paper border border-hairline/70 opacity-75">
        <div className="text-[11px] text-muted mb-1">
          {label} · آیه {toPersianDigits(c.aya)}
        </div>
        <p className="font-quran text-lg leading-loose text-ink mb-1">{arabic(c.arabic)}</p>
        {c.translation && <p className="text-xs text-muted leading-6">{c.translation}</p>}
      </div>
    ) : null;

  return (
    <div
      className={`fixed inset-0 z-50 bg-ink/15 backdrop-blur-[1px] flex justify-end ${
        closing ? "animate-backdrop-out" : "animate-backdrop-in"
      }`}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="بافت و ترجمه آیه"
        className={`w-full max-w-lg bg-surface h-full shadow-2xl border-r border-hairline flex flex-col ${
          closing ? "animate-drawer-out" : "animate-drawer-in"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-hairline flex items-center justify-between">
          <div>
            <div className="text-[11px] text-muted font-mono mb-0.5">
              <bdi>{verse.doc_id}</bdi>
            </div>
            <h3 className="text-sm font-semibold text-ink">{verse.address}</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-parchment text-muted hover:text-ink transition-colors"
            aria-label="بستن"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="space-y-2">
            <div className="text-xs text-muted">مترجم</div>
            <div className="flex flex-wrap gap-1 bg-paper border border-hairline p-1 rounded-lg">
              {translators.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTranslator(t.id)}
                  className={`px-3 py-1 rounded-md text-xs transition ${
                    translator === t.id
                      ? "bg-surface text-ink font-medium shadow-sm"
                      : "text-muted hover:text-ink"
                  }`}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div className="text-xs font-medium text-muted">آیات مجاور (سیاق)</div>
            {contextCard(before, "پیشین")}
            <div className="p-4 rounded-xl bg-parchment border border-hairlineStrong">
              <div className="text-[11px] font-semibold text-pine mb-1.5">
                آیه {toPersianDigits(verse.aya)}
              </div>
              <p className="font-quran text-2xl leading-[2.25] text-ink mb-2">
                {arabic(verse.text_display)}
              </p>
              <p key={translator} className="text-[13.5px] text-inkSoft leading-7 animate-fade">
                {translation || "—"}
              </p>
            </div>
            {contextCard(after, "پسین")}
            {!before && !after && (
              <p className="text-xs text-muted">آیه‌ی همسایه‌ای ثبت نشده است.</p>
            )}
          </div>

          {words.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted">تحلیل واژه</div>
              <div className="flex flex-wrap gap-1.5">
                {words.map((w) => (
                  <button
                    key={w}
                    onClick={() => setActiveWord(w === activeWord ? null : w)}
                    className={`font-quran rounded-md border px-2 py-0.5 text-base active:scale-95 transition-[transform,background-color,border-color,color] duration-200 ease-smooth ${
                      activeWord === w
                        ? "border-pine bg-pineSoft text-pine"
                        : "border-hairline bg-paper text-ink hover:border-hairlineStrong"
                    }`}
                    dir="rtl"
                    lang="ar"
                  >
                    {arabic(w)}
                  </button>
                ))}
              </div>
              {concordance && (
                <div className="rounded-lg bg-pineSoft p-3 text-sm text-pine animate-rise">
                  <p className="mb-1 font-medium">
                    «{concordance.word}» — {toPersianDigits(concordance.count)} بار در قرآن
                  </p>
                  <ul className="space-y-0.5 text-xs">
                    {concordance.samples.map((s) => (
                      <li key={s.id}>{s.address}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="p-4 rounded-xl bg-paper border border-hairline space-y-1.5">
            <div className="text-xs font-medium text-ink">توضیح داور</div>
            <p className="text-xs text-inkSoft leading-6">{verse.reason}</p>
          </div>
        </div>

        <div className="p-4 border-t border-hairline bg-paper/60">
          <a
            href={verse.external_url}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-center gap-1.5 bg-ink hover:opacity-90 text-white text-xs font-medium py-2.5 rounded-xl transition"
          >
            <span>مشاهده در quran.com</span>
            <ArrowUpLeft className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
}