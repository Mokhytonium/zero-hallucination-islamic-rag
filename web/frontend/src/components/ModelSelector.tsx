import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Search, Check, RefreshCw } from 'lucide-react';
import { ModelOption } from '../types';

interface Props {
  models: ModelOption[];
  selectedModelId: string;
  onSelect: (id: string) => void;
  isLoadingModels: boolean;
  onRefresh: () => void;
  hasApiKey: boolean;
  onOpenSettings: () => void;
}

export const ModelSelector: React.FC<Props> = ({
  models,
  selectedModelId,
  onSelect,
  isLoadingModels,
  onRefresh,
  hasApiKey,
  onOpenSettings
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'free' | 'recommended'>('all');
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = models.find((m) => m.id === selectedModelId) || models[0];

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const filtered = models.filter((m) => {
    const matchesSearch =
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.id.toLowerCase().includes(search.toLowerCase());
    if (!matchesSearch) return false;
    if (filter === 'free') return Boolean(m.isFree);
    if (filter === 'recommended') return Boolean(m.recommended);
    return true;
  });

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="inline-flex items-center gap-1.5 text-xs text-inkSoft hover:text-ink hover:bg-parchment px-2.5 py-1.5 rounded-lg transition-colors"
      >
        <span className="max-w-[140px] sm:max-w-[180px] truncate font-medium">
          {selected ? selected.name : 'انتخاب مدل'}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 opacity-60 transition-transform duration-300 ease-smooth ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && (
        <div className="absolute z-50 bottom-full mb-2 right-0 w-[310px] sm:w-[340px] rounded-xl bg-surface border border-hairlineStrong shadow-menu overflow-hidden animate-menu">
          {/* Search Input */}
          <div className="p-2.5 border-b border-hairline flex items-center gap-2">
            <Search className="w-3.5 h-3.5 text-muted shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="جست‌وجوی نام یا شناسه مدل..."
              autoFocus
              className="w-full text-xs bg-transparent outline-none text-ink placeholder:text-muted"
            />
            <button
              type="button"
              onClick={onRefresh}
              title="بروزرسانی لیست مدل‌ها از پروایدر"
              className="p-1 text-muted hover:text-ink rounded transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingModels ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Filter Tabs */}
          <div className="px-2.5 py-1.5 bg-paper border-b border-hairline flex items-center justify-between text-[11px]">
            <div className="flex items-center gap-1">
              {[
                { id: 'all', label: 'همه' },
                { id: 'recommended', label: 'پیشنهادی' },
                { id: 'free', label: 'رایگان' }
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setFilter(t.id as 'all' | 'free' | 'recommended')}
                  className={`px-2 py-0.5 rounded-md transition ${
                    filter === t.id
                      ? 'bg-surface text-ink font-medium border border-hairline'
                      : 'text-muted hover:text-ink'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <span className="text-muted">{filtered.length} مدل</span>
          </div>

          {/* Model List */}
          <div className="max-h-[250px] overflow-y-auto py-1">
            {!hasApiKey ? (
              <div className="p-4 text-center space-y-2">
                <p className="text-xs text-muted">
                  برای دریافت لیست کامل مدل‌ها از پروایدر، ابتدا کلید API خود را وارد کنید.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onOpenSettings();
                  }}
                  className="text-xs font-medium text-pine hover:underline"
                >
                  تنظیم کلید API
                </button>
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-4 text-center text-xs text-muted">
                مدلی با این عبارت پیدا نشد.
              </div>
            ) : (
              filtered.map((m) => {
                const isSelected = m.id === selectedModelId;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      onSelect(m.id);
                      setOpen(false);
                    }}
                    className={`w-full text-right px-3 py-2 flex items-center justify-between gap-2 text-xs hover:bg-paper transition-colors ${
                      isSelected ? 'bg-parchment/70' : ''
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-ink truncate">{m.name}</div>
                      <div className="text-[10.5px] text-muted font-mono truncate" dir="ltr">
                        {m.id}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {m.isFree && (
                        <span className="text-[10px] text-pine bg-pineSoft px-1.5 py-0.5 rounded">
                          رایگان
                        </span>
                      )}
                      {m.contextLength && (
                        <span className="text-[10px] text-muted font-mono">
                          {m.contextLength}
                        </span>
                      )}
                      {isSelected && <Check className="w-3.5 h-3.5 text-ink" />}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};