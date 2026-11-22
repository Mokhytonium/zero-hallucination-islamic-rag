import { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  PanelRightClose,
  PanelRightOpen,
  Settings,
  ArrowUp,
  Square,
  Trash2,
  Search,
  ArrowDown,
  Copy,
  Check,
  ShieldCheck,
  X,
} from "lucide-react";
import { useStore } from "./store/useStore";
import { segmentsToText } from "./lib/refs";
import { copyText, formatLatency, relativeTime, toPersianDigits } from "./lib/format";
import { readBoolPref, writePref } from "./lib/persist";
import { InlineVerseCard } from "./components/InlineVerseCard";
import { ThinkingAccordion } from "./components/ThinkingAccordion";
import { EvidenceDrawer } from "./components/EvidenceDrawer";
import { ByokModal } from "./components/ByokModal";
import { ModelSelector } from "./components/ModelSelector";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { Toasts } from "./components/Toasts";
import { useToast } from "./store/useToast";
import type { ChatMessage, VerifiedVerse } from "./types";

const EXAMPLES = [
  {
    label: "استثنای اضطرار در دروغ",
    q: "آیا دروغ گفتن در قرآن به طور مطلق ممنوع است یا در شرایط اضطرار استثنا دارد؟",
  },
  {
    label: "مقایسه ربا و بیع",
    q: "گرفتن سود اضافی در قبال مهلت دادن به بدهکار هیچ فرقی با خرید و فروش عادی ندارد.",
  },
  {
    label: "صبر در سختی‌ها",
    q: "قرآن کریم درباره صبر و شکیبایی در برابر سختی‌ها چه می‌گوید؟",
  },
];

/** Plain-text version of an answer for the clipboard: prose plus the full
 * byte-exact verses that were cited, so a copied answer stays self-contained. */
function answerToClipboard(msg: ChatMessage, dict: Record<string, VerifiedVerse>): string {
  const parts: string[] = [];
  for (const seg of msg.segments) {
    if (seg.type === "text") {
      const text = seg.text.trim();
      if (text) parts.push(text);
    } else {
      const verse = dict[seg.docId];
      if (verse) {
        parts.push(`${verse.text_display}\n${verse.translations.makarem ?? ""}\n(${verse.address})`);
      }
    }
  }
  return parts.join("\n\n");
}

function CopyAnswerButton({
  msg,
  dict,
}: {
  msg: ChatMessage;
  dict: Record<string, VerifiedVerse>;
}) {
  const [copied, setCopied] = useState(false);
  const push = useToast((s) => s.push);

  const onCopy = async () => {
    const ok = await copyText(answerToClipboard(msg, dict));
    if (!ok) {
      push("کپی پاسخ ممکن نشد.", "error");
      return;
    }
    setCopied(true);
    push("پاسخ همراه با آیات کپی شد.", "success");
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="flex items-center gap-3 mt-1 opacity-70 md:opacity-0 md:group-hover/answer:opacity-100 md:focus-within:opacity-100 transition-opacity duration-200">
      <button
        type="button"
        onClick={onCopy}
        className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-ink transition-colors"
        aria-label="کپی پاسخ همراه با آیات"
      >
        {copied ? (
          <Check className="w-3.5 h-3.5 text-pine" />
        ) : (
          <Copy className="w-3.5 h-3.5" />
        )}
        <span className={copied ? "text-pine" : undefined}>{copied ? "کپی شد" : "کپی پاسخ"}</span>
      </button>
    </div>
  );
}

export function App() {
  const init = useStore((s) => s.init);
  const sessions = useStore((s) => s.sessions);
  const activeSessionId = useStore((s) => s.activeSessionId);
  const messages = useStore((s) => s.messages);
  const evidenceDict = useStore((s) => s.evidenceDict);
  const streaming = useStore((s) => s.streaming);
  const error = useStore((s) => s.error);
  const plainArabic = useStore((s) => s.plainArabic);
  const togglePlainArabic = useStore((s) => s.togglePlainArabic);
  const drawer = useStore((s) => s.drawer);
  const openDrawer = useStore((s) => s.openDrawer);
  const closeDrawer = useStore((s) => s.closeDrawer);
  const byok = useStore((s) => s.byok);
  const models = useStore((s) => s.models);
  const isLoadingModels = useStore((s) => s.isLoadingModels);
  const fetchStatus = useStore((s) => s.fetchStatus);
  const fetchError = useStore((s) => s.fetchError);
  const fetchModels = useStore((s) => s.fetchModels);
  const setModel = useStore((s) => s.setModel);
  const newChat = useStore((s) => s.newChat);
  const selectSession = useStore((s) => s.selectSession);
  const removeSession = useStore((s) => s.removeSession);
  const send = useStore((s) => s.send);
  const cancel = useStore((s) => s.cancel);
  const dismissError = useStore((s) => s.dismissError);
  const loadingSession = useStore((s) => s.loadingSession);
  const pushToast = useToast((s) => s.push);

  const [sidebarOpen, setSidebarOpen] = useState(() => {
    const wide = typeof window === "undefined" || window.innerWidth >= 768;
    return wide && readBoolPref("qr_sidebar_open", true);
  });
  const [input, setInput] = useState("");
  const [byokOpen, setByokOpen] = useState(false);
  const [sessionSearch, setSessionSearch] = useState("");
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);
  const [pinned, setPinned] = useState(true);
  const [hasNew, setHasNew] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        composerRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    writePref("qr_sidebar_open", sidebarOpen ? "1" : "0");
  }, [sidebarOpen]);

  useEffect(() => {
    if (!pinned) {
      setHasNew(true);
      return;
    }
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    // `pinned` is read intentionally at the moment content changes; adding it
    // as a dependency would re-scroll just because the user scrolled up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, streaming]);

  useEffect(() => {
    setPinned(true);
    setHasNew(false);
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeSessionId]);

  const filteredSessions = useMemo(() => {
    const q = sessionSearch.trim();
    return q ? sessions.filter((s) => s.title.includes(q)) : sessions;
  }, [sessions, sessionSearch]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    setPinned(atBottom);
    if (atBottom) setHasNew(false);
  };

  const scrollToLatest = () => {
    setPinned(true);
    setHasNew(false);
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleSelectSession = (id: string) => {
    selectSession(id);
    if (window.innerWidth < 768) setSidebarOpen(false);
  };

  const confirmDelete = () => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) return;
    removeSession(target.id)
      .then(() => pushToast("گفت‌وگو حذف شد.", "success"))
      .catch(() => pushToast("حذف گفت‌وگو ممکن نشد.", "error"));
  };

  const isHero = activeSessionId === null && messages.length === 0;
  const streamingMsg = messages.find((m) => m.streaming);
  const lastStep = streamingMsg?.trace[streamingMsg.trace.length - 1];
  const activeHopText = lastStep?.title || "در حال تجزیه پرسش و جست‌وجو در قرآن...";
  const selectedModelName =
    models.find((m) => m.id === byok.model)?.name || byok.model || "مدل پیش‌فرض";

  const handleSend = (customQuery?: string) => {
    const query = (customQuery ?? input).trim();
    if (!query || streaming) return;
    if (!byok.key) {
      setByokOpen(true);
      return;
    }
    setInput("");
    send(query);
  };

  const renderComposer = (hero: boolean) => (
    <div className="w-full">
      {streaming && !hero && (
        <div className="mx-3 px-4 py-2 rounded-t-xl bg-ink text-white flex items-center justify-between text-xs animate-rise">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>{activeHopText}</span>
          </div>
          <button
            onClick={cancel}
            className="inline-flex items-center gap-1 text-[11px] bg-white/15 hover:bg-white/25 px-2.5 py-0.5 rounded-md transition"
          >
            <Square className="w-2.5 h-2.5 fill-current" />
            <span>توقف</span>
          </button>
        </div>
      )}

      <div className="bg-surface border border-hairlineStrong/80 focus-within:border-ink/40 rounded-2xl shadow-composer p-3 transition-[border-color,box-shadow,background-color] duration-300 ease-smooth">
        <textarea
          ref={composerRef}
          rows={hero ? 3 : 2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={hero ? "پرسش یا گزاره پژوهشی خود را بنویسید..." : "پرسش تکمیلی..."}
          aria-label="متن پرسش"
          className="w-full resize-none border-0 outline-none bg-transparent text-[14.5px] leading-7 px-2 text-ink placeholder:text-muted/70"
        />

        <div className="flex items-center justify-between pt-2 mt-1 border-t border-hairline/60 px-1">
          <ModelSelector
            models={models}
            selectedModelId={byok.model}
            onSelect={setModel}
            isLoadingModels={isLoadingModels}
            onRefresh={() => fetchModels(byok.provider, byok.key)}
            hasApiKey={Boolean(byok.key)}
            onOpenSettings={() => setByokOpen(true)}
          />

          <button
            type="button"
            onClick={() => handleSend()}
            disabled={!input.trim() || streaming}
            className="w-8 h-8 rounded-lg bg-ink text-white flex items-center justify-center hover:opacity-85 active:scale-95 disabled:opacity-25 disabled:active:scale-100 transition-[opacity,transform] duration-200 ease-smooth"
            aria-label="ارسال پرسش"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-paper text-ink overflow-hidden">
      <aside
        aria-hidden={!sidebarOpen}
        className={`fixed inset-y-0 right-0 z-40 md:static md:inset-auto md:z-auto shrink-0 overflow-hidden bg-sidebar border-l border-hairline shadow-2xl md:shadow-none transition-[width,opacity,visibility] duration-300 ease-smooth ${
          sidebarOpen ? "w-[260px] opacity-100 visible" : "w-0 opacity-0 invisible"
        }`}
      >
        <div className="w-[260px] h-full flex flex-col justify-between p-3">
          <div className="space-y-5 overflow-y-auto">
            <div className="flex items-center justify-between px-2 pt-1">
              <span className="text-sm font-semibold tracking-tight text-ink">میزان</span>
              <button
                onClick={() => setSidebarOpen(false)}
                className="p-1.5 rounded-lg text-muted hover:text-ink hover:bg-hairline/60 transition"
                title="بستن نوار کناری"
              >
                <PanelRightClose className="w-4 h-4" />
              </button>
            </div>

            <button
              onClick={newChat}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition ${
                isHero
                  ? "bg-surface text-ink border border-hairline shadow-sm"
                  : "text-inkSoft hover:bg-surface/60"
              }`}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>پژوهش جدید</span>
            </button>

            <div className="px-1">
              <div className="flex items-center justify-between px-2 mb-1.5">
                <div className="text-[11px] text-muted">گفت‌وگوها</div>
                {sessions.length > 0 && (
                  <span className="text-[10px] text-muted/70 font-mono">
                    {toPersianDigits(sessions.length)}
                  </span>
                )}
              </div>

              {sessions.length > 2 && (
                <div className="relative mb-1.5">
                  <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted" />
                  <input
                    value={sessionSearch}
                    onChange={(e) => setSessionSearch(e.target.value)}
                    placeholder="جست‌وجو در گفت‌وگوها..."
                    aria-label="جست‌وجو در گفت‌وگوها"
                    className="w-full bg-surface/70 border border-hairline rounded-lg pr-7 pl-2 py-1.5 text-[11px] text-ink outline-none focus:border-hairlineStrong transition-colors placeholder:text-muted/80"
                  />
                </div>
              )}

              <div className="space-y-0.5">
                {sessions.length === 0 && (
                  <p className="text-[11px] text-muted px-2.5 py-1">هنوز گفت‌وگویی ثبت نشده است.</p>
                )}
                {sessions.length > 0 && filteredSessions.length === 0 && (
                  <p className="text-[11px] text-muted px-2.5 py-1">
                    گفت‌وگویی با این عنوان پیدا نشد.
                  </p>
                )}
                {filteredSessions.map((s, i) => (
                  <div
                    key={s.id}
                    style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}
                    className={`group flex items-center gap-1 rounded-lg text-xs transition animate-rise ${
                      activeSessionId === s.id
                        ? "bg-surface text-ink font-medium border border-hairline/80"
                        : "text-inkSoft hover:text-ink hover:bg-surface/50"
                    }`}
                  >
                    <button
                      onClick={() => handleSelectSession(s.id)}
                      className="flex-1 min-w-0 text-right px-2.5 py-1.5"
                    >
                      <span className="block truncate">{s.title}</span>
                      <span className="block text-[10px] text-muted/80 mt-0.5">
                        {relativeTime(s.updated_at)}
                      </span>
                    </button>
                    <button
                      onClick={() => setPendingDelete({ id: s.id, title: s.title })}
                      className="p-1.5 ml-1 rounded-md text-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-crimson hover:bg-crimsonSoft transition"
                      title="حذف گفت‌وگو"
                      aria-label={`حذف گفت‌وگو ${s.title}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-hairline">
            <button
              onClick={() => setByokOpen(true)}
              className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs text-inkSoft hover:text-ink hover:bg-surface/70 transition"
            >
              <span className="flex items-center gap-2">
                <Settings className="w-3.5 h-3.5" />
                <span>کلید API و مدل‌ها</span>
              </span>
              <span className="text-[10px] text-muted uppercase font-mono">{byok.provider}</span>
            </button>
          </div>
        </div>
      </aside>

      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-ink/20 backdrop-blur-[1px] md:hidden animate-backdrop-in"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <main className="flex-1 flex flex-col h-full relative min-w-0">
        <header className="h-13 py-3 px-5 flex items-center justify-between shrink-0">
          <div>
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-1.5 rounded-lg text-muted hover:text-ink hover:bg-parchment transition animate-fade"
                aria-label="بازکردن نوار کناری"
              >
                <PanelRightOpen className="w-4 h-4" />
              </button>
            )}
          </div>

          <button
            onClick={togglePlainArabic}
            className={`text-xs px-2.5 py-1 rounded-lg border transition ${
              plainArabic
                ? "bg-ink text-white border-ink"
                : "bg-transparent text-muted border-hairline hover:text-ink"
            }`}
          >
            {plainArabic ? "با اعراب" : "بدون اعراب"}
          </button>
        </header>

        {isHero ? (
          <div className="flex-1 flex flex-col items-center justify-center px-4 pb-20">
            <div className="w-full max-w-[660px] space-y-6">
              <div
                className="text-center space-y-1.5 animate-rise"
                style={{ animationDelay: "40ms" }}
              >
                <h1 className="text-2xl font-semibold tracking-tight text-ink">
                  پژوهش مستند در قرآن کریم
                </h1>
                <p className="text-xs text-muted">
                  تمام آیات مستقیماً از پایگاه داده واکشی می‌شوند و به quran.com ارجاع دارند.
                </p>
                <p className="inline-flex items-center gap-1.5 text-[11px] text-muted/90 pt-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-pine" />
                  کلید API فقط در همین مرورگر می‌ماند؛ متن آیات بایت‌به‌بایت از پایگاه داده می‌آید.
                </p>
              </div>

              <div className="animate-rise" style={{ animationDelay: "130ms" }}>
                {renderComposer(true)}
              </div>

              <div className="flex flex-wrap items-center justify-center gap-2">
                {EXAMPLES.map((item, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSend(item.q)}
                    style={{ animationDelay: `${240 + idx * 55}ms` }}
                    className="text-xs text-inkSoft hover:text-ink bg-surface hover:bg-parchment border border-hairline px-3 py-1.5 rounded-lg animate-rise transition-[transform,background-color,color,border-color,box-shadow] duration-200 ease-smooth hover:-translate-y-0.5 hover:shadow-sm active:translate-y-0"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div
              ref={scrollRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto px-4 sm:px-8 pb-10"
            >
              {loadingSession ? (
                <div
                  className="max-w-[700px] mx-auto space-y-6 pt-8"
                  aria-busy="true"
                  aria-label="در حال بارگذاری گفت‌وگو"
                >
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="space-y-2.5">
                      <div className="h-3.5 w-1/3 rounded bg-hairline/60 animate-shimmer" />
                      <div className="h-3 w-full rounded bg-hairline/50 animate-shimmer" />
                      <div className="h-3 w-5/6 rounded bg-hairline/50 animate-shimmer" />
                    </div>
                  ))}
                </div>
              ) : (
              <div className="max-w-[700px] mx-auto space-y-8 pt-2">
                {messages.map((msg, msgIdx) => (
                  <div
                    key={msg.id}
                    className="animate-rise"
                    style={{ animationDelay: `${Math.min(msgIdx, 8) * 40}ms` }}
                  >
                    {msg.role === "user" ? (
                      <div className="flex justify-start">
                        <div className="bg-sidebar border border-hairline rounded-2xl rounded-tr-sm px-4 py-3 max-w-[85%] text-[14.5px] leading-7 text-ink transition-colors duration-200">
                          {segmentsToText(msg.segments)}
                        </div>
                      </div>
                    ) : (
                      <div className="group/answer">
                        {msg.trace.length > 0 && (
                          <ThinkingAccordion
                            steps={msg.trace}
                            meta={{
                              hops: msg.meta?.hops_used ?? msg.trace.length,
                              latency: formatLatency(msg.meta?.latency_s),
                              verifiedCount: msg.evidence.length,
                              modelName: selectedModelName,
                            }}
                          />
                        )}

                        {msg.isNotFound ? (
                          <p className="text-sm text-ochre bg-ochreSoft/60 border border-ochre/20 rounded-xl px-4 py-3 leading-6 animate-pop">
                            {segmentsToText(msg.segments)}
                          </p>
                        ) : (
                          <div
                            className="text-[15px] leading-[2] text-ink"
                            aria-live={msg.streaming ? "polite" : undefined}
                            aria-busy={msg.streaming || undefined}
                          >
                            {msg.streaming && msg.segments.length === 0 && (
                              <div
                                className="flex items-center gap-1.5 py-1 text-muted animate-fade"
                                aria-label="در حال نوشتن پاسخ"
                              >
                                <span className="typing-dot" />
                                <span className="typing-dot" />
                                <span className="typing-dot" />
                              </div>
                            )}
                            {msg.segments.map((seg, idx) =>
                              seg.type === "text" ? (
                                <p key={idx} className="whitespace-pre-line my-2.5 animate-fade">
                                  {seg.text}
                                  {msg.streaming && idx === msg.segments.length - 1 && (
                                    <span className="stream-caret" aria-hidden="true" />
                                  )}
                                </p>
                              ) : evidenceDict[seg.docId] ? (
                                <InlineVerseCard
                                  key={idx}
                                  verse={evidenceDict[seg.docId]}
                                  plainArabic={plainArabic}
                                  onOpenDrawer={openDrawer}
                                />
                              ) : null
                            )}
                          </div>
                        )}
                        {!msg.streaming && !msg.isNotFound && (
                          <CopyAnswerButton msg={msg} dict={evidenceDict} />
                        )}
                      </div>
                    )}
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
              )}
            </div>

            {hasNew && (
              <button
                type="button"
                onClick={scrollToLatest}
                className="absolute bottom-[7.25rem] left-1/2 -translate-x-1/2 z-20 inline-flex items-center gap-1.5 rounded-full bg-ink text-white text-[11px] px-3 py-1.5 shadow-menu animate-rise hover:opacity-90 transition-opacity"
              >
                <ArrowDown className="w-3.5 h-3.5" />
                پیام جدید
              </button>
            )}

            <div className="px-4 pb-5 pt-2 bg-gradient-to-t from-paper via-paper to-transparent shrink-0">
              <div className="max-w-[700px] mx-auto space-y-2">
                {error && (
                  <div className="flex items-start gap-2 text-xs text-crimson bg-crimsonSoft/70 border border-crimson/20 rounded-xl px-4 py-2.5 leading-6 animate-rise">
                    <p className="flex-1">{error}</p>
                    <button
                      type="button"
                      onClick={dismissError}
                      className="p-0.5 rounded text-crimson/70 hover:text-crimson transition-colors"
                      aria-label="بستن پیام خطا"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
                {renderComposer(false)}
              </div>
            </div>
          </>
        )}
      </main>

      <EvidenceDrawer verse={drawer} plainArabic={plainArabic} onClose={closeDrawer} />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="حذف گفت‌وگو"
        description={
          pendingDelete
            ? `«${pendingDelete.title}» و همهٔ پیام‌های آن حذف می‌شود. این کار قابل بازگشت نیست.`
            : undefined
        }
        confirmLabel="حذف گفت‌وگو"
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />

      <Toasts />

      <ByokModal
        open={byokOpen}
        onClose={() => setByokOpen(false)}
        apiKey={byok.key}
        provider={byok.provider}
        onSaveAndFetch={fetchModels}
        isLoadingModels={isLoadingModels}
        fetchStatus={fetchStatus}
        fetchError={fetchError}
      />
    </div>
  );
}

export default App;