import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT,
    translator TEXT,
    language TEXT,
    version TEXT,
    url TEXT,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS surahs (
    id INTEGER PRIMARY KEY,
    name_ar TEXT NOT NULL,
    name_en TEXT,
    transliteration TEXT,
    ayah_count INTEGER NOT NULL,
    revelation_place TEXT,
    revelation_order INTEGER
);

CREATE TABLE IF NOT EXISTS records (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    sura INTEGER,
    aya INTEGER,
    text_display TEXT NOT NULL,
    text_index TEXT NOT NULL,
    page INTEGER,
    juz INTEGER,
    hizb INTEGER,
    prev_id TEXT,
    next_id TEXT,
    metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS translations (
    record_id TEXT NOT NULL,
    translator_id TEXT NOT NULL,
    language TEXT NOT NULL,
    text_display TEXT NOT NULL,
    text_index TEXT NOT NULL,
    PRIMARY KEY (record_id, translator_id)
);

CREATE TABLE IF NOT EXISTS vectors (
    record_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    model TEXT NOT NULL,
    dim INTEGER NOT NULL,
    vec BLOB NOT NULL,
    PRIMARY KEY (record_id, kind, model)
);

CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5(
    text_index, content='records', content_rowid='rowid', tokenize='unicode61'
);

CREATE VIRTUAL TABLE IF NOT EXISTS translations_fts USING fts5(
    text_index, content='translations', content_rowid='rowid', tokenize='unicode61'
);

CREATE TABLE IF NOT EXISTS cache (
    query_hash TEXT PRIMARY KEY,
    pipeline_version TEXT NOT NULL,
    embed_model TEXT NOT NULL,
    judge_model TEXT NOT NULL,
    response TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS api_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL DEFAULT (datetime('now')),
    model TEXT NOT NULL,
    purpose TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL,
    completion_tokens INTEGER NOT NULL,
    cost_usd REAL NOT NULL
);
"""


def connect(path: Path | str) -> sqlite3.Connection:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA foreign_keys=ON")
    return con


def init_schema(con: sqlite3.Connection) -> None:
    con.executescript(SCHEMA)


def rebuild_fts(con: sqlite3.Connection) -> None:
    con.execute("INSERT INTO records_fts(records_fts) VALUES('rebuild')")
    con.execute("INSERT INTO translations_fts(translations_fts) VALUES('rebuild')")
    con.commit()


def get_records(con: sqlite3.Connection, ids: list[str]) -> dict[str, sqlite3.Row]:
    if not ids:
        return {}
    marks = ",".join("?" for _ in ids)
    rows = con.execute(f"SELECT * FROM records WHERE id IN ({marks})", ids).fetchall()
    return {r["id"]: r for r in rows}


def get_translation(
    con: sqlite3.Connection, record_id: str, translator_id: str
) -> sqlite3.Row | None:
    return con.execute(
        "SELECT * FROM translations WHERE record_id=? AND translator_id=?",
        (record_id, translator_id),
    ).fetchone()


def fts_search_records(con: sqlite3.Connection, query: str, limit: int) -> list[sqlite3.Row]:
    return con.execute(
        """
        SELECT r.id, bm25(records_fts) AS score
        FROM records_fts JOIN records r ON r.rowid = records_fts.rowid
        WHERE records_fts MATCH ?
        ORDER BY score LIMIT ?
        """,
        (query, limit),
    ).fetchall()


def fts_search_translations(
    con: sqlite3.Connection, query: str, limit: int
) -> list[sqlite3.Row]:
    return con.execute(
        """
        SELECT t.record_id AS id, t.translator_id, bm25(translations_fts) AS score
        FROM translations_fts JOIN translations t ON t.rowid = translations_fts.rowid
        WHERE translations_fts MATCH ?
        ORDER BY score LIMIT ?
        """,
        (query, limit),
    ).fetchall()


def insert_vectors(
    con: sqlite3.Connection, rows: list[tuple[str, str, str, int, bytes]]
) -> None:
    con.executemany(
        "INSERT OR REPLACE INTO vectors(record_id, kind, model, dim, vec) VALUES (?,?,?,?,?)",
        rows,
    )
    con.commit()


def load_vectors(
    con: sqlite3.Connection, model: str, kind: str
) -> list[tuple[str, bytes]]:
    return [
        (r["record_id"], r["vec"])
        for r in con.execute(
            "SELECT record_id, vec FROM vectors WHERE model=? AND kind=? ORDER BY record_id",
            (model, kind),
        )
    ]


def cache_get(con: sqlite3.Connection, query_hash: str, version_key: tuple) -> str | None:
    row = con.execute(
        """
        SELECT response FROM cache
        WHERE query_hash=? AND pipeline_version=? AND embed_model=? AND judge_model=?
        """,
        (query_hash, *version_key),
    ).fetchone()
    return row["response"] if row else None


def cache_set(
    con: sqlite3.Connection, query_hash: str, version_key: tuple, response: str
) -> None:
    con.execute(
        """
        INSERT OR REPLACE INTO cache(query_hash, pipeline_version, embed_model, judge_model, response)
        VALUES (?,?,?,?,?)
        """,
        (query_hash, *version_key, response),
    )
    con.commit()


def log_usage(
    con: sqlite3.Connection,
    model: str,
    purpose: str,
    prompt_tokens: int,
    completion_tokens: int,
    cost_usd: float,
) -> None:
    con.execute(
        "INSERT INTO api_usage(model, purpose, prompt_tokens, completion_tokens, cost_usd) "
        "VALUES (?,?,?,?,?)",
        (model, purpose, prompt_tokens, completion_tokens, cost_usd),
    )
    con.commit()


def total_cost(con: sqlite3.Connection) -> float:
    return con.execute("SELECT COALESCE(SUM(cost_usd), 0) AS c FROM api_usage").fetchone()["c"]