from .. import store
from ..pipeline import _hydrate, _verse_view
from ..retrieve import Candidate, hybrid_candidates
from ..settings import Settings


class QuranSource:
    id = "quran"
    tier = 1
    label = "قرآن کریم"

    def search(
        self, settings: Settings, query: str, k: int | None = None, light: bool = False
    ) -> list[Candidate]:
        s = settings
        if light:
            s = settings.model_copy(
                update={
                    "use_reranker": False,
                    "retrieval_pool": settings.hop_retrieval_pool,
                    "top_k": settings.hop_top_k,
                }
            )
        return hybrid_candidates(s, query, k=k, sources=[self.id])

    def get_context(self, settings: Settings, doc_id: str) -> dict | None:
        con = store.connect(settings.db_path)
        try:
            r = store.get_records(con, [doc_id]).get(doc_id)
            if r is None:
                return None
            return {
                "doc_id": doc_id,
                "verse": _verse_view(con, doc_id, settings),
                "before": _verse_view(con, r["prev_id"], settings),
                "after": _verse_view(con, r["next_id"], settings),
            }
        finally:
            con.close()

    def hydrate(
        self, con, cand: Candidate, label: str, settings: Settings, reason: str = ""
    ) -> dict:
        return _hydrate(con, cand, label, settings, reason)

    def validate_ref(self, con, doc_id: str) -> bool:
        return doc_id in store.get_records(con, [doc_id])

    def external_url(self, doc_id: str) -> str:
        parts = doc_id.split(":")
        if len(parts) >= 3 and parts[0] == self.id:
            return f"https://quran.com/{parts[1]}/{parts[2]}"
        return "https://quran.com"