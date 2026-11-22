import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useToast, type ToastTone } from "../store/useToast";

const TONES: Record<ToastTone, { icon: typeof Info; cls: string; iconCls: string }> = {
  success: {
    icon: CheckCircle2,
    cls: "border-pine/25 bg-pineSoft/95 text-pine",
    iconCls: "text-pine",
  },
  error: {
    icon: AlertCircle,
    cls: "border-crimson/25 bg-crimsonSoft/95 text-crimson",
    iconCls: "text-crimson",
  },
  info: {
    icon: Info,
    cls: "border-hairlineStrong bg-surface/95 text-inkSoft",
    iconCls: "text-muted",
  },
};

export function Toasts() {
  const toasts = useToast((s) => s.toasts);
  const dismiss = useToast((s) => s.dismiss);

  if (!toasts.length) return null;

  return (
    <div
      className="fixed bottom-4 left-4 z-[60] flex flex-col gap-2 max-w-[calc(100vw-2rem)] pointer-events-none"
      role="status"
      aria-live="polite"
    >
      {toasts.map((toast) => {
        const tone = TONES[toast.tone];
        const Icon = tone.icon;
        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-xs shadow-menu backdrop-blur animate-rise ${tone.cls}`}
          >
            <Icon className={`w-3.5 h-3.5 shrink-0 ${tone.iconCls}`} />
            <span className="leading-5">{toast.message}</span>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              className="p-0.5 rounded text-current/70 hover:text-current transition-colors"
              aria-label="بستن پیام"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
