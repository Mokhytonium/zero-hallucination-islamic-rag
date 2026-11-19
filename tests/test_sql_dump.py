from islamic_rag.sql_dump import iter_rows

DUMP = r"""
INSERT INTO `t1` (`id`, `sura`, `aya`, `text`) VALUES
(1, 1, 1, 'بسم الله'),
(2, 2, 1, 'نص فيه \'علامت\' و "دوبل"'),
(3, 2, 2, 'خط\nجديد و \\ backpage'),
(4, 9, 1, NULL);

INSERT INTO `t1` (`id`, `sura`, `aya`, `text`) VALUES
(5, 9, 2, 'it''s doubled');

INSERT INTO `t2` (`id`, `name`) VALUES (1, 'سوره');
"""


def test_parses_rows_and_escapes():
    rows = list(iter_rows(DUMP))
    t1 = [r for r in rows if r[0] == "t1"]
    t2 = [r for r in rows if r[0] == "t2"]
    assert len(t1) == 5
    assert len(t2) == 1
    assert t1[0][2] == (1, 1, 1, "بسم الله")
    assert t1[1][2][3] == "نص فيه 'علامت' و \"دوبل\""
    assert t1[2][2][3] == "خط\nجديد و \\ backpage"
    assert t1[3][2][3] is None
    assert t1[4][2][3] == "it's doubled"
    assert t2[0][1] == ["id", "name"]


def test_empty_and_no_insert():
    assert list(iter_rows("CREATE TABLE x (id int);")) == []