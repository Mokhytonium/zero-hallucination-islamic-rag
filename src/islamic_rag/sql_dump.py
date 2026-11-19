import re
from collections.abc import Iterator

_INSERT = re.compile(r"INSERT INTO `(?P<table>\w+)` \((?P<cols>[^)]*)\) VALUES\s*")

_ESCAPES = {
    "n": "\n",
    "r": "\r",
    "t": "\t",
    "0": "\0",
    "Z": "\x1a",
    "b": "\b",
    "\\": "\\",
    "'": "'",
    '"': '"',
}

Row = tuple[str, list[str], tuple]


def iter_rows(sql_text: str) -> Iterator[Row]:
    for match in _INSERT.finditer(sql_text):
        table = match.group("table")
        cols = [c.strip().strip("`") for c in match.group("cols").split(",")]
        i = match.end()
        n = len(sql_text)
        while i < n:
            while i < n and sql_text[i] in " \t\r\n,":
                i += 1
            if i >= n or sql_text[i] != "(":
                break
            i += 1
            row: list = []
            while i < n:
                ch = sql_text[i]
                if ch == ")":
                    i += 1
                    break
                if ch in " \t\r\n,":
                    i += 1
                    continue
                if ch == "'":
                    i += 1
                    buf: list[str] = []
                    while i < n:
                        c = sql_text[i]
                        if c == "\\":
                            nxt = sql_text[i + 1] if i + 1 < n else ""
                            buf.append(_ESCAPES.get(nxt, nxt))
                            i += 2
                            continue
                        if c == "'":
                            if i + 1 < n and sql_text[i + 1] == "'":
                                buf.append("'")
                                i += 2
                                continue
                            i += 1
                            break
                        buf.append(c)
                        i += 1
                    row.append("".join(buf))
                else:
                    j = i
                    while j < n and sql_text[j] not in ",)":
                        j += 1
                    token = sql_text[i:j].strip()
                    row.append(None if token.upper() == "NULL" else int(token))
                    i = j
            yield table, cols, tuple(row)


def parse_file(path) -> dict[str, list[dict]]:
    tables: dict[str, list[dict]] = {}
    for table, cols, values in iter_rows(path.read_text(encoding="utf-8")):
        tables.setdefault(table, []).append(dict(zip(cols, values, strict=True)))
    return tables