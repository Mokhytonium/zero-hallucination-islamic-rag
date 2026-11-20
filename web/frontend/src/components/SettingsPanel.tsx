import { useState } from "react";
import { cx } from "../lib/format";
import { useStore } from "../store/useStore";
import { Icon } from "./Icon";

export function SettingsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const providers = useStore((s) => s.providers);
  const byok = useStore((s) => s.byok);
  const setByok = useStore((s) => s.setByok);
  const diacritics = useStore((s) => s.diacritics);
  const toggleDiacritics = useStore((s) => s.toggleDiacritics);
  const [showKey, setShowKey] = useState(false);

  if (!open) return null;
  const current = providers.find((p) => p.id === byok.provider);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/30 backdrop-blur-[2px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="تنظیمات"
        className="relative z-10 w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-[0_20px_60px_rgba(39,41,50,0.25)]"
      >
        <header className="mb-4 flex items-center gap-2">
          <Icon name="settings" className="h-5 w-5 text-secondary" />
          <h3 className="text-base font-semibold text-ink">تنظیمات</h3>
          <button
            type="button"
            onClick={onClose}
            className="ms-auto rounded p-1.5 text-secondary hover:bg-subtle hover:text-ink"
            aria-label="بستن"
          >
            <Icon name="close" className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-ink" htmlFor="provider">
              ارائه‌دهنده
            </label>
            <select
              id="provider"
              value={byok.provider}
              onChange={(e) => setByok({ provider: e.target.value, model: "" })}
              className="w-full rounded-lg border border-line bg-page px-3 py-2 text-sm text-ink outline-none focus:border-focus"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink" htmlFor="model">
              مدل
            </label>
            <select
              id="model"
              value={byok.model}
              onChange={(e) => setByok({ model: e.target.value })}
              className="w-full rounded-lg border border-line bg-page px-3 py-2 text-sm text-ink outline-none focus:border-focus"
            >
              <option value="">پیش‌فرض ({current?.default_model ?? "—"})</option>
              {current?.models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink" htmlFor="key">
              کلید API شما (BYOK)
            </label>
            <div className="flex items-center gap-2 rounded-lg border border-line bg-page px-3 focus-within:border-focus">
              <input
                id="key"
                type={showKey ? "text" : "password"}
                value={byok.key}
                onChange={(e) => setByok({ key: e.target.value })}
                placeholder="sk-…"
                autoComplete="off"
                spellCheck={false}
                className="flex-1 bg-transparent py-2 text-sm text-ink outline-none placeholder:text-muted"
                dir="ltr"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="text-xs text-secondary hover:text-ink"
              >
                {showKey ? "پنهان" : "نمایش"}
              </button>
            </div>
            <p className="mt-1.5 text-[11px] leading-5 text-muted">
              کلید فقط در حافظه‌ی موقت همین مرورگر (sessionStorage) می‌ماند و با هر درخواست به‌صورت
              گذرا در هدر ارسال می‌شود؛ روی سرور ذخیره نمی‌شود. زمان اجرا هرگز از کلید پروژه استفاده
              نمی‌کند.
            </p>
          </div>

          <div className="flex items-center justify-between rounded-lg bg-subtle px-3 py-2.5">
            <span className="text-sm text-ink">نمایش اعراب متن عربی</span>
            <button
              type="button"
              role="switch"
              aria-checked={diacritics}
              onClick={toggleDiacritics}
              className={cx(
                "relative h-6 w-11 rounded-full transition-colors",
                diacritics ? "bg-green" : "bg-line"
              )}
            >
              <span
                className={cx(
                  "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all",
                  diacritics ? "right-0.5" : "right-[22px]"
                )}
              />
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full rounded-xl bg-dark py-2.5 text-sm font-medium text-white transition-colors hover:bg-ink"
        >
          ذخیره و بستن
        </button>
      </div>
    </div>
  );
}