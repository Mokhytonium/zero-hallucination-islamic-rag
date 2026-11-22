import { AlertTriangle } from "lucide-react";
import { useDialogA11y } from "../lib/useDialogA11y";
import { usePresence } from "../lib/usePresence";

interface Props {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "تأیید",
  cancelLabel = "انصراف",
  onConfirm,
  onCancel,
}: Props) {
  const { mounted, closing } = usePresence(open);
  const ref = useDialogA11y<HTMLDivElement>(open && mounted, onCancel);

  if (!mounted) return null;

  return (
    <div
      className={`fixed inset-0 z-50 bg-ink/25 backdrop-blur-[1px] flex items-center justify-center p-4 ${
        closing ? "animate-backdrop-out" : "animate-backdrop-in"
      }`}
      onClick={onCancel}
    >
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby={description ? "confirm-dialog-desc" : undefined}
        className={`w-full max-w-sm bg-surface rounded-2xl border border-hairlineStrong shadow-2xl p-5 space-y-4 ${
          closing ? "animate-modal-out" : "animate-modal-in"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 w-7 h-7 rounded-full bg-crimsonSoft text-crimson flex items-center justify-center shrink-0">
            <AlertTriangle className="w-3.5 h-3.5" />
          </span>
          <div className="min-w-0">
            <h3 id="confirm-dialog-title" className="text-sm font-semibold text-ink">
              {title}
            </h3>
            {description && (
              <p id="confirm-dialog-desc" className="text-xs text-muted leading-6 mt-1">
                {description}
              </p>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-xs text-muted hover:bg-parchment transition"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2 rounded-xl text-xs font-medium bg-crimson text-white hover:opacity-90 active:scale-[0.98] transition-[opacity,transform] duration-200 ease-smooth"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
