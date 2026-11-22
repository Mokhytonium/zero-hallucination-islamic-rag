export interface ChatPayload {
  message: string;
  session_id?: string | null;
  sources?: string[] | null;
  provider?: string | null;
  model?: string | null;
}

export type EventHandler = (name: string, data: Record<string, unknown>) => void;

function parseBlock(raw: string): { name: string; data: Record<string, unknown> } | null {
  let name = "message";
  let dataStr = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) name = line.slice(6).trim();
    else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
  }
  if (!dataStr) return null;
  try {
    return { name, data: JSON.parse(dataStr) };
  } catch {
    return null;
  }
}

export async function streamChat(
  payload: ChatPayload,
  key: string,
  signal: AbortSignal,
  onEvent: EventHandler
): Promise<void> {
  const resp = await fetch("/api/agent/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-LLM-Key": key },
    body: JSON.stringify(payload),
    signal,
  });
  if (!resp.ok) {
    const j = await resp.json().catch(() => ({}));
    throw new Error((j as { message?: string }).message || `HTTP ${resp.status}`);
  }
  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const block = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      const ev = parseBlock(block);
      if (ev) onEvent(ev.name, ev.data);
    }
  }
}