import { useEffect, useState } from "react";
import { Composer } from "./components/Composer";
import { EvidenceDrawer } from "./components/EvidenceDrawer";
import { Icon } from "./components/Icon";
import { MessageList } from "./components/MessageList";
import { SettingsPanel } from "./components/SettingsPanel";
import { Sidebar } from "./components/Sidebar";
import { useStore } from "./store/useStore";

export default function App() {
  const init = useStore((s) => s.init);
  const error = useStore((s) => s.error);
  const sessions = useStore((s) => s.sessions);
  const activeId = useStore((s) => s.activeSessionId);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [input, setInput] = useState("");

  useEffect(() => {
    void init();
  }, [init]);

  const title = sessions.find((s) => s.id === activeId)?.title || "گفت‌وگوی جدید";

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onOpenSettings={() => {
          setSettingsOpen(true);
          setSidebarOpen(false);
        }}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-line bg-surface px-4 py-2.5 sm:px-6">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="rounded p-1.5 text-secondary hover:bg-subtle lg:hidden"
            aria-label="گشودن منو"
          >
            <Icon name="menu" className="h-5 w-5" />
          </button>
          <h2 className="truncate text-sm font-medium text-ink">{title}</h2>
          <span className="ms-auto hidden items-center gap-1 rounded-full bg-green-bg px-2.5 py-1 text-[11px] text-green sm:flex">
            <Icon name="check" className="h-3 w-3" />
            ۰٪ توهم متنی · استناد بایت‌دقیق
          </span>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="rounded p-1.5 text-secondary hover:bg-subtle hover:text-ink"
            aria-label="تنظیمات"
          >
            <Icon name="settings" className="h-5 w-5" />
          </button>
        </header>

        {error && (
          <div className="flex items-start gap-2 border-b border-rose/20 bg-rose-bg px-4 py-2.5 text-sm text-rose sm:px-6">
            <Icon name="close" className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="flex-1">{error}</p>
            <button
              type="button"
              onClick={() => useStore.setState({ error: null })}
              className="rounded px-1.5 text-xs hover:bg-rose/10"
            >
              بستن
            </button>
          </div>
        )}

        <MessageList onExample={setInput} />
        <Composer value={input} onChange={setInput} />
      </div>

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <EvidenceDrawer />
    </div>
  );
}