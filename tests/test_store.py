from islamic_rag import store


def test_schema_and_fts_roundtrip():
    con = store.connect(":memory:")
    store.init_schema(con)
    con.execute(
        "INSERT INTO records(id, source, sura, aya, text_display, text_index) "
        "VALUES ('quran:2:255','quran',2,255,'اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ','الله لا اله الا هو')"
    )
    con.execute(
        "INSERT INTO translations(record_id, translator_id, language, text_display, text_index) "
        "VALUES ('quran:2:255','fa.makarem','fa','خداوند یکتا','خداوند يكتا')"
    )
    store.rebuild_fts(con)
    hits = store.fts_search_records(con, "اله", 5)
    assert [h["id"] for h in hits] == ["quran:2:255"]
    thits = store.fts_search_translations(con, "يكوتا", 5)
    assert thits == []
    thits = store.fts_search_translations(con, "يكتا", 5)
    assert [h["id"] for h in thits] == ["quran:2:255"]
    got = store.get_records(con, ["quran:2:255"])
    assert got["quran:2:255"]["text_display"].startswith("اللَّهُ")


def test_cache_versioning():
    con = store.connect(":memory:")
    store.init_schema(con)
    key = ("v1", "modelA", "judgeA")
    assert store.cache_get(con, "h1", key) is None
    store.cache_set(con, "h1", key, '{"ok": true}')
    assert store.cache_get(con, "h1", key) == '{"ok": true}'
    assert store.cache_get(con, "h1", ("v2", "modelA", "judgeA")) is None