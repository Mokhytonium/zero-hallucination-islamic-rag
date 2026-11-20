import { cx } from "../lib/format";
import { useStore } from "../store/useStore";
import { Icon } from "./Icon";

const FUTURE_SOURCES = ["نهج‌البلاغه", "کافی", "تفسیر المیزان"];

function shortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("fa-IR", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

export function Sidebar({
  open,
  onClose,
  onOpenSettings,
}: {
  open: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  const sessions = useStore((s) => s.sessions);
  const activeId = useStore((s) => s.activeSessionId);
  const newChat = useStore((s) => s.newChat);
  const selectSession = useStore((s) => s.selectSession);
  const removeSession = useStore((s) => s.removeSession);
  const hasKey = useStore((s) => Boolean(s.byok.key));

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-20 bg-ink/30 lg:hidden" onClick={onClose} aria-hidden="true" />
      )}
      <aside
        className={cx(
          "fixed inset-y-0 right-0 z-30 flex w-72 flex-col border-l border-line bg-surface transition-transform",
          "lg:static lg:z-auto lg:translate-x-0",
          open ? "translate-x-0" : "translate-x-full"
        )}
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-bg text-green">
            <Icon name="book" className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-ink">پژوهش مستند قرآن</h1>
            <p className="text-[11px] text-muted">استناد بایت‌دقیق · بدون توهم متنی</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ms-auto rounded p-1.5 text-secondary hover:bg-subtle lg:hidden"
            aria-label="بستن منو"
          >
            <Icon name="close" className="h-4 w-4" />
          </button>
        </div>

        <div className="px-3 py-3">
          <button
            type="button"
            onClick={() => {
              newChat();
              onClose();
            }}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-page py-2 text-sm font-medium text-ink transition-colors hover:border-focus hover:bg-subtle"
          >
            <Icon name="plus" className="h-4 w-4" />
            گفت‌وگوی جدید
          </button>
        </div>

        <div className="px-4 pb-2">
          <h2 className="mb-1.5 text-[11px] font-medium text-muted">منابع پژوهش</h2>
          <div className="space-y-1">
            <div className="flex items-center gap-2 rounded-lg bg-green-bg px-2.5 py-1.5 text-sm text-green">
              <Icon name="check" className="h-3.5 w-3.5" />
              قرآن کریم
              <span className="ms-auto text-[10px]">درجه ۱ · حاکم</span>
            </div>
            {FUTURE_SOURCES.map((s) => (
              <div
                key={s}
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-muted"
                title="به‌زودی — رجیستری منابع آماده‌ی افزودن است"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-line" />
                {s}
                <span className="ms-auto text-[10px]">به‌زودی</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-2 flex-1 overflow-y-auto px-3">
          <h2 className="mb-1.5 px-1 text-[11px] font-medium text-muted">تاریخچه‌ی گفت‌وگو</h2>
          {sessions.length === 0 && (
            <p className="px-1 py-2 text-xs text-muted">هنوز گفت‌وگویی ثبت نشده است.</p>
          )}
          <ul className="space-y-1">
            {sessions.map((s) => (
              <li key={s.id} className="group relative">
                <button
                  type="button"
                  onClick={() => {
                    void selectSession(s.id);
                    onClose();
                  }}
                  className={cx(
                    "flex w-full flex-col rounded-lg px-2.5 py-2 text-start transition-colors",
                    activeId === s.id ? "bg-subtle" : "hover:bg-subtle/60"
                  )}
                >
                  <span className="truncate pe-6 text-sm text-ink">{s.title || "گفت‌وگوی بی‌نام"}</span>
                  <span className="text-[11px] text-muted">{shortDate(s.updated_at)}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void removeSession(s.id)}
                  className="absolute left-1.5 top-1.5 rounded p-1 text-muted opacity-0 transition-opacity hover:bg-rose-bg hover:text-rose group-hover:opacity-100"
                  title="حذف گفت‌وگو"
                  aria-label="حذف گفت‌وگو"
                >
                  <Icon name="trash" className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="border-t border-line p-3">
          <button
            type="button"
            onClick={onOpenSettings}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-secondary transition-colors hover:bg-subtle hover:text-ink"
          >
            <Icon name="settings" className="h-4 w-4" />
            تنظیمات و کلید API
            <span
              className={cx("ms-auto h-2 w-2 rounded-full", hasKey ? "bg-green" : "bg-amber")}
              title={hasKey ? "کلید وارد شده" : "کلید وارد نشده"}
            />
          </button>
        </div>
      </aside>
    </>
  );
}