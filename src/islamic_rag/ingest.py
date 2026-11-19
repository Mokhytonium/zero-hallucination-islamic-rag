import json
import re
from typing import TYPE_CHECKING

from . import store
from .normalize import normalize, strip_bismillah

if TYPE_CHECKING:
    from .settings import Settings

_FA_TRANSLATIONS = ["fa.ansarian", "fa.ayati", "fa.bahrampour", "fa.makarem"]

_HEADER_FIELD = re.compile(r"^#\s+(Name|Translator|Language|ID|Last Update|Source):\s*(.+)$", re.MULTILINE)
_ASCII = re.compile(r"[A-Za-z]")


def _validate_textual_integrity(clean: dict, surah_rows: list) -> None:
    # The source dump once contained "N-TRIAL-... M" watermark corruption; normalized
    # Arabic index text must never contain Latin letters, and surah type must be valid.
    bad = [f"{s}:{a}" for (s, a), txt in clean.items() if _ASCII.search(txt)]
    if bad:
        raise ValueError(f"آلودگی داده در متن ایندکس (نویسه‌ی لاتین): {bad[:10]}")
    bad_surahs = [
        r["id"]
        for r in surah_rows
        if r["type"] not in ("Meccan", "Medinan") or _ASCII.search(r["name"])
    ]
    if bad_surahs:
        raise ValueError(f"آلودگی داده در متادیتای سوره: {bad_surahs}")


def _translation_header(path) -> dict[str, str]:
    head = path.read_text(encoding="utf-8")[:2000]
    return {m.group(1): m.group(2).strip() for m in _HEADER_FIELD.finditer(head)}


def build(settings: "Settings") -> dict:
    raw = settings.raw_quran
    from .sql_dump import parse_file

    tables = parse_file(raw / "quran.sql")

    surah_rows = tables["suras"]
    display = {(r["sura"], r["aya"]): r for r in tables["quran_text"]}
    clean = {(r["sura"], r["aya"]): r["text"] for r in tables["quran_clean_text"]}
    assert len(display) == 6236, f"expected 6236 ayahs, got {len(display)}"
    assert len(clean) == 6236
    assert len(surah_rows) == 114
    _validate_textual_integrity(clean, surah_rows)

    con = store.connect(settings.db_path)
    store.init_schema(con)
    for t in ("records", "translations", "surahs", "sources", "vectors"):
        con.execute(f"DELETE FROM {t}")

    con.execute(
        "INSERT INTO sources(id, kind, name, url, notes) VALUES (?,?,?,?,?)",
        (
            "quran.uthmani",
            "scripture",
            "Quran Uthmani text",
            "https://tanzil.net",
            "Display text from quran_text table; index text from quran_clean_text",
        ),
    )

    surah_meta = {}
    for r in surah_rows:
        surah_meta[r["id"]] = r
        con.execute(
            "INSERT INTO surahs(id, name_ar, name_en, transliteration, ayah_count, "
            "revelation_place, revelation_order) VALUES (?,?,?,?,?,?,?)",
            (
                r["id"],
                r["name"],
                r["ename"],
                r["tname"],
                r["ayas"],
                r["type"],
                r["order"],
            ),
        )

    keys = sorted(display)
    record_rows = []
    for sura, aya in keys:
        d = display[(sura, aya)]
        meta = surah_meta[sura]
        prev_id = f"quran:{sura}:{aya - 1}" if aya > 1 else None
        next_id = (
            f"quran:{sura}:{aya + 1}" if aya < meta["ayas"] else None
        )
        metadata = {
            "revelation_place": meta["type"],
            "revelation_order": meta["order"],
            "surah_name": meta["name"],
            "sha_nuzul": None,
            "sha_nuzul_source": None,
        }
        record_rows.append(
            (
                f"quran:{sura}:{aya}",
                "quran",
                sura,
                aya,
                d["text"],
                strip_bismillah(normalize(clean[(sura, aya)]), sura, aya),
                d["page"],
                d["juz"],
                d["hezb"],
                prev_id,
                next_id,
                json.dumps(metadata, ensure_ascii=False),
            )
        )
    con.executemany(
        "INSERT INTO records(id, source, sura, aya, text_display, text_index, page, juz, hizb, "
        "prev_id, next_id, metadata) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        record_rows,
    )

    translation_counts = {}
    for tid in _FA_TRANSLATIONS:
        path = raw / "trns" / f"{tid}.sql"
        header = _translation_header(path)
        tr_tables = parse_file(path)
        rows = next(iter(tr_tables.values()))
        assert len(rows) == 6236, f"{tid}: expected 6236 rows, got {len(rows)}"
        con.execute(
            "INSERT INTO sources(id, kind, name, translator, language, version, url) "
            "VALUES (?,?,?,?,?,?,?)",
            (
                tid,
                "translation",
                header.get("Name"),
                header.get("Translator"),
                header.get("Language", "Persian"),
                header.get("Last Update"),
                header.get("Source", "Tanzil.net"),
            ),
        )
        con.executemany(
            "INSERT INTO translations(record_id, translator_id, language, text_display, text_index) "
            "VALUES (?,?,?,?,?)",
            [
                (
                    f"quran:{r['sura']}:{r['aya']}",
                    tid,
                    "fa",
                    r["text"],
                    normalize(r["text"]),
                )
                for r in rows
            ],
        )
        translation_counts[tid] = len(rows)

    store.rebuild_fts(con)

    checks = {
        "ayahs": con.execute("SELECT COUNT(*) c FROM records").fetchone()["c"],
        "surahs": con.execute("SELECT COUNT(*) c FROM surahs").fetchone()["c"],
        "translations": translation_counts,
        "fts_records": con.execute("SELECT COUNT(*) c FROM records_fts").fetchone()["c"],
    }
    r21 = con.execute("SELECT text_index FROM records WHERE id='quran:2:1'").fetchone()
    r91 = con.execute("SELECT text_index FROM records WHERE id='quran:9:1'").fetchone()
    r11 = con.execute("SELECT text_index FROM records WHERE id='quran:1:1'").fetchone()
    assert r21["text_index"] == "الم", r21["text_index"]
    assert not r91["text_index"].startswith("بسم")
    assert r11["text_index"].startswith("بسم")
    for s in surah_rows:
        n = con.execute(
            "SELECT COUNT(*) c FROM records WHERE sura=?", (s["id"],)
        ).fetchone()["c"]
        assert n == s["ayas"], f"surah {s['id']}: {n} != {s['ayas']}"

    con.commit()
    con.close()
    return checks