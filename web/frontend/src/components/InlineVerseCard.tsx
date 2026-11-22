import React, { useState } from 'react';
import { ArrowUpLeft, BookOpen, Copy, Check } from 'lucide-react';
import { VerifiedVerse } from '../types';
import { copyText, toPersianDigits } from '../lib/format';
import { useToast } from '../store/useToast';

interface Props {
  verse: VerifiedVerse;
  plainArabic: boolean;
  onOpenDrawer: (verse: VerifiedVerse) => void;
}

export const InlineVerseCard: React.FC<Props> = ({
  verse,
  plainArabic,
  onOpenDrawer
}) => {
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const pushToast = useToast((s) => s.push);

  const verdictMeta = {
    Direct_Match: { label: 'تطبیق مستقیم', dot: 'bg-pine', text: 'text-pine' },
    Conditional_Match: { label: 'قید و استثنا', dot: 'bg-ochre', text: 'text-ochre' },
    Contradiction: { label: 'دیدگاه مخالف', dot: 'bg-crimson', text: 'text-crimson' }
  }[verse.label];

  const handleCopy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const ok = await copyText(
      `${verse.text_display}\n${verse.translations.makarem}\n(${verse.address})`
    );
    if (!ok) {
      pushToast('کپی آیه ممکن نشد.', 'error');
      return;
    }
    setCopied(true);
    pushToast('آیه همراه با ترجمه کپی شد.', 'success');
    setTimeout(() => setCopied(false), 1600);
  };

  const handleDrawer = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onOpenDrawer(verse);
  };

  return (
    <div
      className="relative my-6 animate-rise"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Editorial Manuscript-style Quote Block -> Click opens Quran.com */}
      <a
        href={verse.external_url}
        target="_blank"
        rel="noopener noreferrer"
        className="block rounded-xl bg-parchment/80 hover:bg-parchment border border-hairline hover:border-hairlineStrong px-5 py-4 group transition-[background-color,border-color,transform,box-shadow] duration-300 ease-smooth hover:-translate-y-0.5 hover:shadow-cardHover"
      >
        {/* Quiet Top Meta Line */}
        <div className="flex items-center justify-between gap-2 pb-3 mb-3.5 border-b border-hairline/70 text-xs">
          <div className="flex items-center gap-2.5">
            <span className={`w-1.5 h-1.5 rounded-full ${verdictMeta.dot}`} />
            <span className="font-semibold text-ink">{verse.address}</span>
            <span className="text-hairlineStrong">·</span>
            <span className={`text-[11px] font-medium ${verdictMeta.text}`}>
              {verdictMeta.label}
            </span>
          </div>

          <div className="flex items-center gap-3 text-[11px] text-muted">
            <span className="hidden sm:inline font-mono text-[10.5px] opacity-75">
              <bdi>{verse.doc_id}</bdi>
            </span>
            <span className="inline-flex items-center gap-0.5 group-hover:text-ink transition-colors">
              <span>quran.com</span>
              <ArrowUpLeft className="w-3 h-3" />
            </span>
          </div>
        </div>

        {/* Arabic Calligraphy */}
        <p className="font-quran text-[24px] sm:text-[26px] leading-[2.3] text-ink text-right mb-3">
          {plainArabic ? verse.text_plain : verse.text_display}
        </p>

        {/* Persian Translation */}
        <p className="text-[13.5px] leading-7 text-inkSoft mb-3.5">
          {verse.translations.makarem}
        </p>

        {/* Subtle Utility Bar */}
        <div className="flex items-center justify-between pt-2 text-[11px] text-muted">
          <span>
            {verse.revelation_place} · صفحه{' '}
            {verse.page === null ? '—' : toPersianDigits(verse.page)} · جزء{' '}
            {verse.juz === null ? '—' : toPersianDigits(verse.juz)}
          </span>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleDrawer}
              className="inline-flex items-center gap-1 hover:text-ink transition-colors"
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>بافت و ترجمه</span>
            </button>
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1 hover:text-ink transition-colors"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-pine" />
                  <span className="text-pine">کپی شد</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>کپی</span>
                </>
              )}
            </button>
          </div>
        </div>
      </a>

      {/* Quiet Editorial Hover Popover */}
      {hovered && (
        <div className="hidden md:block absolute z-40 bottom-full mb-2 right-0 w-[390px] rounded-xl bg-surface border border-hairlineStrong p-4 shadow-popover pointer-events-none animate-menu">
          <div className="flex items-center justify-between text-[11px] text-muted pb-2 mb-2 border-b border-hairline">
            <span className="font-medium text-ink">
              رکورد پایگاه داده (<bdi>{verse.doc_id}</bdi>)
            </span>
            <span>اطمینان: {toPersianDigits(verse.confidence)}٪</span>
          </div>
          <p className="text-xs leading-6 text-inkSoft mb-2.5">{verse.reason}</p>
          <div className="flex items-center justify-between text-[11px] text-muted">
            <span>
              معنایی {toPersianDigits(verse.signals.semantic)}٪ · واژگانی{' '}
              {toPersianDigits(verse.signals.lexical)}٪
            </span>
            <span className="text-pine font-medium">کلیک برای quran.com ↖</span>
          </div>
        </div>
      )}
    </div>
  );
};