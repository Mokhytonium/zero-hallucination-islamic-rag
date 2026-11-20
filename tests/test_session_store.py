from islamic_rag.session import store as ss


def _con(tmp_path):
    return ss.connect_sessions(tmp_path / "sessions.db")


def test_create_and_list(tmp_path):
    con = _con(tmp_path)
    sid = ss.create_session(con, "گفت‌وگوی اول")
    sessions = ss.list_sessions(con)
    assert len(sessions) == 1
    assert sessions[0]["id"] == sid
    assert sessions[0]["title"] == "گفت‌وگوی اول"
    con.close()


def test_message_roundtrip_with_evidence(tmp_path):
    con = _con(tmp_path)
    sid = ss.create_session(con)
    evidence = [{"doc_id": "quran:2:255", "text_display": "نص", "tier": 1}]
    trace = [{"hop": 1, "phase": "planning", "title": "تجزیه"}]
    mid = ss.add_message(
        con, sid, "assistant", content="پاسخ [[REF:quran:2:255]]",
        evidence=evidence, trace=trace, meta={"hops_used": 2},
    )
    msgs = ss.get_messages(con, sid)
    assert len(msgs) == 1
    m = msgs[0]
    assert m["id"] == mid
    assert m["role"] == "assistant"
    assert m["evidence"] == evidence
    assert m["trace"] == trace
    assert m["meta"]["hops_used"] == 2
    con.close()


def test_messages_ordered_and_multi_turn(tmp_path):
    con = _con(tmp_path)
    sid = ss.create_session(con)
    ss.add_message(con, sid, "user", content="سؤال ۱")
    ss.add_message(con, sid, "assistant", content="پاسخ ۱")
    ss.add_message(con, sid, "user", content="سؤال ۲")
    msgs = ss.get_messages(con, sid)
    assert [m["content"] for m in msgs] == ["سؤال ۱", "پاسخ ۱", "سؤال ۲"]
    con.close()


def test_delete_cascades_messages(tmp_path):
    con = _con(tmp_path)
    sid = ss.create_session(con)
    ss.add_message(con, sid, "user", content="x")
    ss.delete_session(con, sid)
    assert ss.get_session(con, sid) is None
    assert ss.get_messages(con, sid) == []
    con.close()


def test_update_title(tmp_path):
    con = _con(tmp_path)
    sid = ss.create_session(con, "قدیمی")
    ss.update_session_title(con, sid, "جدید")
    assert ss.get_session(con, sid)["title"] == "جدید"
    con.close()