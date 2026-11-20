from .. import store
from ..normalize import normalize
from ..retrieve import Candidate
from ..settings import Settings
from ..sources.registry import SourceRegistry


def retrieve_evidence(
    settings: Settings,
    registry: SourceRegistry,
    query: str,
    sources: list[str] | None = None,
    k: int | None = None,
    light: bool = True,
) -> list[Candidate]:
    wanted = sources or registry.ids()
    out: list[Candidate] = []
    for sid in wanted:
        source = registry.get(sid)
        if source is not None:
            out.extend(source.search(settings, query, k=k, light=light))
    return out


def get_verse_context(
    settings: Settings, registry: SourceRegistry, doc_id: str
) -> dict | None:
    source = registry.source_of_doc(doc_id)
    return source.get_context(settings, doc_id) if source else None


def concordance(settings: Settings, word: str) -> dict:
    token = normalize(word).split(" ")[0] if normalize(word) else ""
    if len(token) < 2:
        return {"word": token, "count": 0, "samples": []}
    match = '"' + token.replace('"', "") + '"'
    con = store.connect(settings.db_path)
    try:
        count = con.execute(
            "SELECT COUNT(*) c FROM records_fts WHERE records_fts MATCH ?", (match,)
        ).fetchone()["c"]
        rows = con.execute(
            """
            SELECT r.id, r.sura, r.aya, r.metadata
            FROM records_fts JOIN records r ON r.rowid = records_fts.rowid
            WHERE records_fts MATCH ? LIMIT 6
            """,
            (match,),
        ).fetchall()
    finally:
        con.close()
    import json

    samples = []
    for r in rows:
        meta = json.loads(r["metadata"])
        samples.append(
            {
                "id": r["id"],
                "address": f"{meta.get('surah_name', '')} ({r['sura']}:{r['aya']})",
            }
        )
    return {"word": token, "count": count, "samples": samples}