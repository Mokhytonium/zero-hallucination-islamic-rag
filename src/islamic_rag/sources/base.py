from typing import Protocol, runtime_checkable

from ..retrieve import Candidate
from ..settings import Settings


@runtime_checkable
class Source(Protocol):
    """A retrievable scripture corpus. Adding a source = implementing this
    protocol and registering it; the orchestrator and frontend stay unchanged.

    `id` MUST equal the value stored in records.source (e.g. "quran"), not the
    sources-table primary key (e.g. "quran.uthmani").
    """

    id: str
    tier: int
    label: str

    def search(
        self, settings: Settings, query: str, k: int | None = None, light: bool = False
    ) -> list[Candidate]: ...

    def get_context(self, settings: Settings, doc_id: str) -> dict | None: ...

    def hydrate(
        self, con, cand: Candidate, label: str, settings: Settings, reason: str = ""
    ) -> dict: ...

    def validate_ref(self, con, doc_id: str) -> bool: ...

    def external_url(self, doc_id: str) -> str: ...