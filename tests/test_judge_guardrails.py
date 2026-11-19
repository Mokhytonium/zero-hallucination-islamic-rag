import json

from islamic_rag import store
from islamic_rag.judge import _build_user, _parse
from islamic_rag.retrieve import Candidate
from islamic_rag.settings import Settings


def test_parse_drops_unknown_ids_and_labels():
    valid = {"quran:2:255", "quran:49:13"}
    text = (
        '{"results":['
        '{"id":"quran:2:255","label":"Direct_Match","reason":"ok"},'
        '{"id":"quran:99:99","label":"Direct_Match","reason":"invented"},'
        '{"id":"quran:49:13","label":"Bogus_Label","reason":"bad"},'
        '{"id":"quran:2:255","label":"Contradiction","reason":"dup"}'
        "]}"
    )
    out = _parse(text, valid)
    assert len(out) == 1
    assert out[0]["id"] == "quran:2:255"
    assert out[0]["label"] == "Direct_Match"


def test_parse_handles_code_fence_and_garbage():
    valid = {"quran:2:255"}
    fenced = '```json\n{"results":[{"id":"quran:2:255","label":"Superficial_Match"}]}\n```'
    assert _parse(fenced, valid)[0]["label"] == "Superficial_Match"
    assert _parse("not json at all", valid) == []
    assert _parse('{"results":[]}', valid) == []


def test_parse_survives_malformed_shapes():
    valid = {"quran:2:255"}
    assert _parse('[{"id":"quran:2:255","label":"Direct_Match"}]', valid) == []
    assert _parse('"just a string"', valid) == []
    mixed = '{"results":["garbage", {"id":"quran:2:255","label":"Direct_Match"}]}'
    assert _parse(mixed, valid)[0]["id"] == "quran:2:255"


def _seed_three_consecutive(tmp_path, monkeypatch):
    s = Settings()
    monkeypatch.setattr(s, "data_dir", tmp_path)
    con = store.connect(s.db_path)
    store.init_schema(con)
    for aya in (190, 191, 192):
        rid = f"quran:2:{aya}"
        con.execute(
            "INSERT INTO records(id, source, sura, aya, text_display, text_index, page, juz, prev_id, next_id, metadata) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (rid, "quran", 2, aya, f"نص {aya}", f"text {aya}", 1, 1,
             f"quran:2:{aya - 1}" if aya > 190 else None,
             f"quran:2:{aya + 1}" if aya < 192 else None,
             json.dumps({"surah_name": "البقرة"})),
        )
        con.execute(
            "INSERT INTO translations(record_id, translator_id, language, text_display, text_index) "
            "VALUES (?,?,?,?,?)",
            (rid, "fa.makarem", "fa", f"ترجمه {aya}", f"tr {aya}"),
        )
    con.commit()
    return s, con


def test_judge_payload_includes_neighbouring_verses(tmp_path, monkeypatch):
    s, con = _seed_three_consecutive(tmp_path, monkeypatch)
    cand = Candidate(
        id="quran:2:191", ids=["quran:2:191"], sura=2, aya_start=191, aya_end=191, score=0.5,
        text_display="نص 191", text_index="text 191", translation_fa="ترجمه 191",
        address="البقرة (2:191)", metadata={"surah_name": "البقرة"},
    )
    payload = json.loads(_build_user(con, "گزاره", [cand], s, True))["candidates"][0]
    assert payload["context_before"]["address"] == "2:190"
    assert payload["context_before"]["translation_fa"] == "ترجمه 190"
    assert payload["context_after"]["address"] == "2:192"
    assert payload["context_after"]["text"] == "text 192"

    plain = json.loads(_build_user(con, "گزاره", [cand], s, False))["candidates"][0]
    assert "context_before" not in plain and "context_after" not in plain
    con.close()


def test_judge_context_handles_surah_boundary(tmp_path, monkeypatch):
    s, con = _seed_three_consecutive(tmp_path, monkeypatch)
    cand = Candidate(
        id="quran:2:190", ids=["quran:2:190"], sura=2, aya_start=190, aya_end=190, score=0.5,
        text_display="نص 190", text_index="text 190", translation_fa="ترجمه 190",
        address="البقرة (2:190)", metadata={"surah_name": "البقرة"},
    )
    payload = json.loads(_build_user(con, "گزاره", [cand], s, True))["candidates"][0]
    assert payload["context_before"] is None
    assert payload["context_after"]["address"] == "2:191"
    con.close()