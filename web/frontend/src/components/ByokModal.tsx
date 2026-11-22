import React, { useState, useEffect } from 'react';
import { X, RefreshCw } from 'lucide-react';
import { ProviderId } from '../types';
import { usePresence } from '../lib/usePresence';
import { useDialogA11y } from '../lib/useDialogA11y';

interface Props {
  open: boolean;
  onClose: () => void;
  apiKey: string;
  provider: ProviderId;
  onSaveAndFetch: (provider: ProviderId, key: string) => Promise<boolean>;
  isLoadingModels: boolean;
  fetchStatus: string | null;
  fetchError: string | null;
}

export const ByokModal: React.FC<Props> = ({
  open,
  onClose,
  apiKey,
  provider,
  onSaveAndFetch,
  isLoadingModels,
  fetchStatus,
  fetchError
}) => {
  const [tempProvider, setTempProvider] = useState<ProviderId>(provider);
  const [tempKey, setTempKey] = useState(apiKey);
  const { mounted, closing } = usePresence(open);
  const formRef = useDialogA11y<HTMLFormElement>(open && mounted, onClose);

  useEffect(() => {
    if (open) {
      setTempProvider(provider);
      setTempKey(apiKey);
    }
  }, [open, provider, apiKey]);

  if (!mounted) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await onSaveAndFetch(tempProvider, tempKey.trim());
    if (ok) onClose();
  };

  return (
    <div
      className={`fixed inset-0 z-50 bg-ink/20 backdrop-blur-[1px] flex items-center justify-center p-4 ${
        closing ? 'animate-backdrop-out' : 'animate-backdrop-in'
      }`}
      onClick={onClose}
    >
      <form
        ref={formRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="byok-title"
        onSubmit={handleSubmit}
        className={`w-full max-w-md bg-surface rounded-2xl border border-hairlineStrong shadow-2xl p-6 space-y-5 ${
          closing ? 'animate-modal-out' : 'animate-modal-in'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 id="byok-title" className="text-sm font-semibold text-ink">
            تنظیمات کلید API و پروایدر
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-parchment text-muted transition-colors"
            aria-label="بستن"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3.5">
          <div>
            <label className="block text-xs text-muted mb-1.5">پروایدر</label>
            <select
              value={tempProvider}
              onChange={(e) => setTempProvider(e.target.value as ProviderId)}
              className="w-full bg-paper border border-hairline rounded-xl px-3 py-2 text-xs text-ink outline-none transition-colors duration-200 focus:border-ink"
            >
              <option value="openrouter">OpenRouter (پیشنهادی)</option>
              <option value="google">Google Gemini</option>
              <option value="openai">OpenAI</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-muted mb-1.5">کلید API</label>
            <input
              type="password"
              value={tempKey}
              onChange={(e) => setTempKey(e.target.value)}
              placeholder="sk-or-v1-..."
              dir="ltr"
              className="w-full bg-paper border border-hairline rounded-xl px-3 py-2 text-xs text-ink outline-none transition-colors duration-200 focus:border-ink font-mono"
            />
          </div>

          <p className="text-[11px] text-muted leading-5">
            با ذخیره کلید، لیست مدل‌های فعال مستقیماً از پروایدر دریافت می‌شود تا از منوی انتخاب مدل قابل جست‌وجو باشند. کلید فقط در <code className="font-mono">sessionStorage</code> مرورگر می‌ماند.
          </p>

          {fetchStatus && (
            <div className="text-[11px] text-pine bg-pineSoft px-3 py-2 rounded-lg">
              {fetchStatus}
            </div>
          )}

          {fetchError && (
            <div className="text-[11px] text-crimson bg-crimsonSoft px-3 py-2 rounded-lg leading-5">
              {fetchError}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs text-muted hover:bg-parchment transition"
          >
            انصراف
          </button>
          <button
            type="submit"
            disabled={isLoadingModels}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium bg-ink text-white hover:opacity-90 disabled:opacity-50 transition"
          >
            {isLoadingModels && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
            <span>ذخیره و دریافت مدل‌ها</span>
          </button>
        </div>
      </form>
    </div>
  );
};