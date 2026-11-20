import { useEffect, useRef } from "react";
import { cx, formatSeconds } from "../lib/format";
import { SECTION_ORDER, SECTION_TITLE, labelStyle } from "../lib/labels";
import type { ChatMessage, Evidence } from "../lib/types";
import { useStore } from "../store/useStore";
import { CitationChip, RejectedRef } from "./CitationChip";
import { Icon } from "./Icon";
import { InlineCitationCard } from "./InlineCitationCard";
import { ThinkingAccordion } from "./ThinkingAccordion";

const EXAMPLES = [
  "صبر در برابر مشکلات فضیلت است.",
  "نیکی به پدر و مادر واجب است.",
  "اسراف و ریخت‌وپاش نکوهیده است.",
];

function EvidenceGrid({ evidence }: { evidence: Evidence[] }) {
  if (!evidence.length) return null;
  const groups = SECTION_ORDER.map((sec) => ({
    sec,
    items: evidence.filter((e) => labelStyle(e.label).section === sec),
  })).filter((g) => g.items.length);

  return (
    <div className="mt-4 space-y-4">
      {groups.map((g) => (
        <section key={g.sec}>
          <h4 className="mb-2 flex items-center gap-2 text-xs font-medium text-muted">
            <span className={cx("h-2 w-2 rounded-full", labelStyle(g.items[0].label).spine)} />
            {SECTION_TITLE[g.sec]}
            <span className="text-[11px]">({g.items.length})</span>
          </h4>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {g.items.map((e) => (
              <InlineCitationCard key={e.doc_id} evidence={e} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function AnswerBody({ msg }: { msg: ChatMessage }) {
  const dict = useStore((s) => s.evidenceDict);
  if (!msg.segments.length && msg.streaming) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <span className="h-2 w-2 animate-pulse rounded-full bg-indigo" />
        در حال اندیشیدن و بازیابی شواهد…
      </p>
    );
  }
  return (
    <div className="text-[15px] leading-8 text-ink">
      {msg.segments.map((seg, i) =>
        seg.type === "text" ? (
          <span key={i} className="whitespace-pre-wrap">
            {seg.text}
          </span>
        ) : dict[seg.docId] ? (
          <CitationChip key={i} evidence={dict[seg.docId]} />
        ) : (
          <RejectedRef key={i} docId={seg.docId} />
        )
      )}
      {msg.streaming && (
        <span className="ms-0.5 inline-block h-4 w-[2px] animate-pulse bg-indigo align-middle" />
      )}
    </div>
  );
}

function MetaFooter({ msg }: { msg: ChatMessage }) {
  const meta = msg.meta;
  if (!meta || msg.streaming) return null;
  const deep = meta.deep_research === true;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
      <span className="flex items-center gap-1">
        <Icon name="layers" className="h-3.5 w-3.5" />
        {String(meta.hops_used ?? "—")} hop
      </span>
      <span>{formatSeconds(meta.latency_s)}</span>
      {meta.judge_model != null && <span>داور: {String(meta.judge_model)}</span>}
      <span
        className={cx(
          "rounded px-1.5 py-0.5",
          deep ? "bg-amber-bg text-amber" : "bg-green-bg text-green"
        )}
      >
        {deep ? "پژوهش عمیق" : "حالت سریع"}
      </span>
    </div>
  );
}

export function MessageList({ onExample }: { onExample: (text: string) => void }) {
  const messages = useStore((s) => s.messages);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  if (!messages.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-green-bg text-green">
          <Icon name="book" className="h-7 w-7" />
        </div>
        <h2 className="mb-1 text-lg font-semibold text-ink">پژوهش مستند قرآن</h2>
        <p className="mb-6 max-w-md text-sm leading-7 text-secondary">
          گزاره یا پرسش خود را بنویسید. ایجنت پژوهشگر، شواهد را از متن دقیق قرآن بازیابی می‌کند و هر
          استناد را به یک آیه‌ی بایت‌دقیق گره می‌زند — بدون هیچ متن ساختگی.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => onExample(ex)}
              className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-secondary transition-colors hover:border-focus hover:text-ink"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
      <div className="mx-auto max-w-3xl space-y-6">
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-start">
              <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-dark px-4 py-2.5 text-[15px] leading-7 text-white">
                <span className="whitespace-pre-wrap">{m.segments.map((s) => (s.type === "text" ? s.text : "")).join("")}</span>
              </div>
            </div>
          ) : (
            <div key={m.id} className="rounded-2xl border border-line bg-surface p-4">
              <ThinkingAccordion trace={m.trace} streaming={m.streaming} />
              <AnswerBody msg={m} />
              <EvidenceGrid evidence={m.evidence} />
              <MetaFooter msg={m} />
            </div>
          )
        )}
        <div ref={bottom} />
      </div>
    </div>
  );
}