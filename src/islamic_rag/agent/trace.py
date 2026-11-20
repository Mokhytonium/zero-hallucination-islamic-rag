from collections.abc import Callable

Emit = Callable[[str, dict], None]

SESSION = "session"
THINKING_STEP = "thinking_step"
EVIDENCE_PAYLOAD = "evidence_payload"
TEXT_DELTA = "text_delta"
REF_REJECTED = "ref_rejected"
COST = "cost"
DONE = "done"
ERROR = "error"


def thinking_step(
    hop: int, phase: str, title: str, detail: str = "", queries: list[str] | None = None
) -> dict:
    data = {"hop": hop, "phase": phase, "title": title, "detail": detail}
    if queries is not None:
        data["queries"] = queries
    return data


class TraceCollector:
    """Test/helper sink that records every emitted (event, data) pair."""

    def __init__(self) -> None:
        self.events: list[tuple[str, dict]] = []

    def __call__(self, name: str, data: dict) -> None:
        self.events.append((name, data))

    def of(self, name: str) -> list[dict]:
        return [d for n, d in self.events if n == name]