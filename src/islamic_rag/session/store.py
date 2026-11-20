import json
import sqlite3
import uuid
from datetime import UTC, datetime
from pathlib import Path

from .. import store

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    evidence TEXT NOT NULL DEFAULT '[]',
    trace TEXT NOT NULL DEFAULT '[]',
    meta TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
"""


def _now() -> str:
    return datetime.now(UTC).isoformat()


def connect_sessions(path: Path | str) -> sqlite3.Connection:
    con = store.connect(path)
    init_sessions_schema(con)
    return con


def init_sessions_schema(con: sqlite3.Connection) -> None:
    con.executescript(SCHEMA)


def create_session(con: sqlite3.Connection, title: str = "") -> str:
    sid = uuid.uuid4().hex
    now = _now()
    con.execute(
        "INSERT INTO sessions(id, title, created_at, updated_at) VALUES (?,?,?,?)",
        (sid, title, now, now),
    )
    con.commit()
    return sid


def update_session_title(con: sqlite3.Connection, session_id: str, title: str) -> None:
    con.execute(
        "UPDATE sessions SET title=?, updated_at=? WHERE id=?",
        (title, _now(), session_id),
    )
    con.commit()


def list_sessions(con: sqlite3.Connection) -> list[dict]:
    rows = con.execute(
        "SELECT id, title, created_at, updated_at FROM sessions ORDER BY updated_at DESC"
    ).fetchall()
    return [dict(r) for r in rows]


def get_session(con: sqlite3.Connection, session_id: str) -> dict | None:
    row = con.execute(
        "SELECT id, title, created_at, updated_at FROM sessions WHERE id=?", (session_id,)
    ).fetchone()
    return dict(row) if row else None


def delete_session(con: sqlite3.Connection, session_id: str) -> None:
    con.execute("DELETE FROM sessions WHERE id=?", (session_id,))
    con.commit()


def add_message(
    con: sqlite3.Connection,
    session_id: str,
    role: str,
    content: str = "",
    evidence: list | None = None,
    trace: list | None = None,
    meta: dict | None = None,
) -> str:
    mid = uuid.uuid4().hex
    con.execute(
        "INSERT INTO messages(id, session_id, role, content, evidence, trace, meta, created_at) "
        "VALUES (?,?,?,?,?,?,?,?)",
        (
            mid,
            session_id,
            role,
            content,
            json.dumps(evidence or [], ensure_ascii=False),
            json.dumps(trace or [], ensure_ascii=False),
            json.dumps(meta or {}, ensure_ascii=False),
            _now(),
        ),
    )
    con.execute("UPDATE sessions SET updated_at=? WHERE id=?", (_now(), session_id))
    con.commit()
    return mid


def get_messages(con: sqlite3.Connection, session_id: str) -> list[dict]:
    rows = con.execute(
        "SELECT id, role, content, evidence, trace, meta, created_at "
        "FROM messages WHERE session_id=? ORDER BY created_at, rowid",
        (session_id,),
    ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["evidence"] = json.loads(d["evidence"])
        d["trace"] = json.loads(d["trace"])
        d["meta"] = json.loads(d["meta"])
        out.append(d)
    return out