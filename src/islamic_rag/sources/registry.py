from ..retrieve import Candidate
from ..settings import Settings
from .base import Source
from .quran import QuranSource


class SourceRegistry:
    def __init__(self) -> None:
        self._sources: dict[str, Source] = {}

    def register(self, source: Source) -> None:
        self._sources[source.id] = source

    def get(self, source_id: str) -> Source | None:
        return self._sources.get(source_id)

    def all(self) -> list[Source]:
        return sorted(self._sources.values(), key=lambda s: (s.tier, s.id))

    def ids(self) -> list[str]:
        return [s.id for s in self.all()]

    def source_of_doc(self, doc_id: str) -> Source | None:
        return self._sources.get(doc_id.split(":", 1)[0])

    def validate_ref(self, con, doc_id: str) -> bool:
        source = self.source_of_doc(doc_id)
        return source.validate_ref(con, doc_id) if source else False

    def hydrate(
        self, con, cand: Candidate, label: str, settings: Settings, reason: str = ""
    ) -> dict:
        source = self._sources.get(cand.source)
        if source is None:
            raise KeyError(f"منبع ثبت‌نشده: {cand.source}")
        payload = source.hydrate(con, cand, label, settings, reason)
        payload["doc_id"] = cand.id
        payload["tier"] = source.tier
        payload["external_url"] = source.external_url(cand.id)
        payload["tafsir_snippet"] = None
        return payload


def default_registry() -> SourceRegistry:
    reg = SourceRegistry()
    reg.register(QuranSource())
    return reg