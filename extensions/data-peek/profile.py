import argparse
import os
import re
import sys
import warnings
from pathlib import Path

OUTPUT_CAP = 4000  # bytes of stdout
CELL_CAP = 30  # characters per sample cell
TOP_VALUES = 10  # max top values shown for low-cardinality text
LOW_CARD = 20  # "low cardinality" threshold


class PeekError(Exception):
    """A clear, user-facing error (printed without a traceback)."""




def env_int(name, default):
    try:
        return max(1, int(os.environ.get(name, default)))
    except ValueError:
        return default


def load_file(path_str, max_rows):
    """Return (df, total_rows_or_None, capped, kind)."""
    import pandas as pd

    path = Path(path_str)
    if not path.exists():
        raise PeekError(f"file not found: {path}")
    if path.is_dir():
        raise PeekError(f"is a directory, not a file: {path}")
    ext = path.suffix.lower()

    if ext in (".csv", ".tsv", ".txt"):
        sep = "\t" if ext == ".tsv" else None  # None + python engine sniffs , ; | etc.
        kw = {"sep": sep, "engine": "python"} if sep is None else {"sep": sep}
        df = pd.read_csv(path, nrows=max_rows + 1, **kw)
        capped = len(df) > max_rows
        if capped:
            df = df.iloc[:max_rows]
        return df, (None if capped else len(df)), capped, "csv"

    if ext == ".parquet":
        try:
            df = pd.read_parquet(path)
        except ImportError:
            raise PeekError("reading parquet needs pyarrow: pip install pyarrow")
        return cap(df, max_rows) + ("parquet",)

    if ext in (".xlsx", ".xlsm", ".xls"):
        try:
            df = pd.read_excel(path, nrows=max_rows + 1)  # first sheet
        except ImportError:
            raise PeekError("reading Excel needs openpyxl: pip install openpyxl")
        capped = len(df) > max_rows
        if capped:
            df = df.iloc[:max_rows]
        return df, (None if capped else len(df)), capped, "excel (first sheet)"

    if ext in (".json", ".jsonl", ".ndjson"):
        lines = ext != ".json"
        try:
            df = pd.read_json(path, lines=lines)
        except ValueError:
            df = pd.read_json(path, lines=not lines)
        return cap(df, max_rows) + ("json",)

    raise PeekError(f"unsupported file type '{ext}'. Use .csv .tsv .parquet .xlsx .json .jsonl, or source='sql'")


def cap(df, max_rows):
    total = len(df)
    capped = total > max_rows
    return (df.iloc[:max_rows] if capped else df), total, capped



FORBIDDEN = re.compile(
    r"\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|exec|execute|call|into|replace|upsert|copy|attach|pragma)\b",
    re.IGNORECASE,
)
IDENTIFIER = re.compile(r'^[\w$#.\[\]"`]+$')


SQL_TOKENS = re.compile(r"'(?:[^']|'')*'|--[^\n]*|/\*.*?\*/", re.DOTALL)


def strip_comments(query):
    """Remove -- and /* */ comments, leaving string literals intact."""
    return SQL_TOKENS.sub(lambda m: m.group(0) if m.group(0).startswith("'") else " ", query).strip()


def strip_sql(query):
    """Remove comments and blank out string literals (for safety checks only)."""
    return SQL_TOKENS.sub(lambda m: "''" if m.group(0).startswith("'") else " ", query).strip()


def check_select(query):
    """Allow exactly one SELECT/WITH statement. Raise PeekError otherwise."""
    bare = strip_sql(query).rstrip(";").strip()
    if ";" in bare:
        raise PeekError("refused: only a single statement is allowed")
    if not re.match(r"^(select|with)\b", bare, re.IGNORECASE):
        raise PeekError("refused: read-only tool, query must be a single SELECT or WITH statement")
    bad = FORBIDDEN.search(bare)
    if bad:
        raise PeekError(f"refused: read-only tool, found '{bad.group(0)}' in the query")
    # Comments removed so a trailing "-- ..." cannot swallow the subquery's closing paren.
    return strip_comments(query).rstrip(";").strip()


def scrub(msg, url):
    """Remove the DB URL and any credentials from an error message."""
    if url:
        msg = msg.replace(url, "<PI_BOOST_DB_URL>")
        try:
            from sqlalchemy.engine import make_url

            pw = make_url(url).password
            if pw:
                msg = msg.replace(str(pw), "***")
        except Exception:
            pass
    msg = re.sub(r"://[^@/\s]+@", "://***@", msg)
    msg = re.sub(r"(?i)(pwd|password)=[^;\s]+", r"\1=***", msg)
    return msg


def load_sql(query, max_rows):
    """Return (df, total_rows, capped, kind). Read-only: the connection is never committed."""
    import pandas as pd

    if not query:
        raise PeekError("source='sql' needs query: a table name or a SELECT statement")
    url = os.environ.get("PI_BOOST_DB_URL", "").strip()
    if not url:
        raise PeekError("SQL mode needs env var PI_BOOST_DB_URL (a SQLAlchemy URL)")
    try:
        import sqlalchemy as sa
    except ImportError:
        raise PeekError("SQL mode needs SQLAlchemy: pip install sqlalchemy")

    # ADAPT: work DB. This block is the only DB-specific part. SQLAlchemy handles most
    # dialects (mssql+pyodbc, oracle+oracledb, snowflake, postgresql) via the URL alone.
    # Things that may need changing at work:
    #   - driver install (e.g. pyodbc + ODBC driver) and URL format / connect_args
    #   - SQL Server rejects ORDER BY inside a subquery (a custom SELECT) without TOP
    #   - non-SQL stores (e.g. kdb+) need their own loader returning a DataFrame here
    try:
        engine = sa.create_engine(url)
        with engine.connect() as conn:  # never committed -> rolled back on close
            if IDENTIFIER.match(query.strip()):
                name = query.strip().replace("[", "").replace("]", "").replace('"', "").replace("`", "")
                schema, _, table_name = name.rpartition(".")
                table = sa.Table(table_name, sa.MetaData(), autoload_with=conn, schema=schema or None)
                source = table
                kind = f"sql table {name}"
            else:
                source = sa.text(check_select(query)).columns().subquery("peek_sub")
                kind = "sql query"
            total = conn.execute(sa.select(sa.func.count()).select_from(source)).scalar()
            stmt = sa.select(table) if kind.startswith("sql table") else sa.select(sa.literal_column("*")).select_from(source)
            df = pd.read_sql(stmt.limit(max_rows), conn)
        engine.dispose()
    except PeekError:
        raise
    except Exception as e:  # scrub anything that might contain credentials
        raise PeekError(scrub(f"{type(e).__name__}: {e}", url).splitlines()[0][:400])
    return df, total, (total or 0) > len(df), kind




def fmt_num(x):
    try:
        if x != x:  # NaN
            return "nan"
        if float(x).is_integer() and abs(x) < 1e15:
            return str(int(x))
        return f"{x:.6g}"
    except (TypeError, ValueError):
        return str(x)


def short(v, n=CELL_CAP):
    s = str(v).replace("\n", " ")
    return s if len(s) <= n else s[: n - 1] + "…"


def looks_numeric_text(s):
    import pandas as pd

    cleaned = s.astype(str).str.replace(r"[,\s%]", "", regex=True).str.replace(r"^\((.*)\)$", r"-\1", regex=True)
    ok = pd.to_numeric(cleaned, errors="coerce").notna().mean()
    return ok >= 0.9


DATE_SHAPE = (
    r"^\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}"  # 2026-01-05, 2026/1/5
    r"|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}"  # 05/01/2026, 5.1.26
    r"|\d{1,2}[-/ ][A-Za-z]{3,9}[-/ ]\d{2,4}"  # 05-Jan-2026
    r"|[A-Za-z]{3,9}\.? \d{1,2},? \d{4})"  # Jan 5, 2026
)


def looks_date_text(s):
    import pandas as pd

    vals = s.astype(str)
    if vals.str.match(DATE_SHAPE).mean() < 0.9:
        return False
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        try:
            parsed = pd.to_datetime(vals, errors="coerce", format="mixed")
        except (TypeError, ValueError):
            parsed = pd.to_datetime(vals, errors="coerce")
    return parsed.notna().mean() >= 0.9


def profile_column(name, s):
    from pandas.api import types as t

    n = len(s)
    nulls = int(s.isna().sum())
    non_null = s.dropna()
    try:
        distinct = int(non_null.nunique())
    except TypeError:  # unhashable (lists/dicts from JSON)
        distinct = int(non_null.astype(str).nunique())
    null_pct = f"{100 * nulls / n:.0f}%" if n else "-"
    if n and 0 < nulls and null_pct == "0%":
        null_pct = "<1%"
    head = f"- {name}  [{s.dtype}]  nulls {null_pct}  distinct {distinct}"
    detail = ""
    flags = []

    if non_null.empty:
        detail = "all null"
    elif t.is_bool_dtype(s):
        detail = "values: " + ", ".join(f"{k} {v}" for k, v in non_null.value_counts().items())
    elif t.is_numeric_dtype(s):
        detail = f"min {fmt_num(non_null.min())}  max {fmt_num(non_null.max())}  mean {fmt_num(non_null.mean())}"
    elif t.is_datetime64_any_dtype(s):
        detail = f"range {non_null.min()} .. {non_null.max()}"
    else:
        sample = non_null.astype(str).head(2000)
        if looks_numeric_text(sample):
            flags.append("numeric stored as text")
        elif looks_date_text(sample):
            flags.append("text that parses as dates")
            strs = non_null.astype(str)
            detail = f"range {strs.min()} .. {strs.max()}  "
        if distinct <= LOW_CARD:
            vc = non_null.astype(str).value_counts()
            top = ", ".join(f"{short(k, 20)} {v}" for k, v in vc.head(TOP_VALUES).items())
            more = f" (+{len(vc) - TOP_VALUES} more)" if len(vc) > TOP_VALUES else ""
            detail += f"top: {top}{more}"
        else:
            ex = ", ".join(short(v, 20) for v in non_null.astype(str).drop_duplicates().head(3))
            detail += f"e.g. {ex}"
    line = f"{head}  {detail}".rstrip()
    if flags:
        line += "  FLAG: " + "; ".join(flags)
    return line


def build_report(df, total, capped, kind, label, sample_rows, columns):
    import pandas as pd

    if columns:
        missing = [c for c in columns if c not in df.columns]
        if missing:
            avail = ", ".join(map(str, df.columns[:40]))
            raise PeekError(f"unknown column(s): {', '.join(missing)}. Available: {avail}")
        df = df[columns]

    rows_str = f"{total:,}" if total is not None else f"more than {len(df):,}"
    head = [f"source: {label} ({kind})", f"shape: {rows_str} rows x {df.shape[1]} columns"]
    if capped:
        head.append(f"note: profiled the first {len(df):,} rows only")
    try:
        dups = int(df.duplicated().sum())
        head.append(f"duplicate rows: {dups}")
    except TypeError:
        pass
    head.append("columns:")
    col_lines = [profile_column(str(c), df[c]) for c in df.columns]

    out = "\n".join(head + col_lines)
    if len(out.encode("utf-8")) > OUTPUT_CAP:
        keep, size = [], len("\n".join(head).encode("utf-8"))
        for ln in col_lines:
            size += len(ln.encode("utf-8")) + 1
            if size > OUTPUT_CAP - 200:
                break
            keep.append(ln)
        out = "\n".join(head + keep)
        out += f"\n[truncated: {len(col_lines) - len(keep)} more columns; call again with columns=[...] to see them]"
        return out

    if sample_rows > 0 and len(df):
        sample = df.head(sample_rows).map(lambda v: short(v)) if hasattr(df, "map") else df.head(sample_rows).applymap(short)
        with pd.option_context("display.width", 10_000, "display.max_columns", None):
            lines = sample.to_string(index=False).splitlines()
        budget = OUTPUT_CAP - len(out.encode("utf-8")) - 80
        shown = []
        for ln in lines:
            ln = ln.rstrip()
            if budget - len(ln.encode("utf-8")) - 1 < 0:
                break
            budget -= len(ln.encode("utf-8")) + 1
            shown.append(ln)
        if len(shown) > 1:
            out += f"\nsample ({len(shown) - 1} rows):\n" + "\n".join(shown)
        else:
            out += "\nsample: omitted (too wide for the output cap; use columns=[...])"
    return out




def main(argv=None):
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass
    p = argparse.ArgumentParser(description="Compact dataset profile for the data_peek tool")
    p.add_argument("--source", required=True, help="file path or 'sql'")
    p.add_argument("--query", default=None, help="table name or SELECT (sql mode)")
    p.add_argument("--sample-rows", type=int, default=5)
    p.add_argument("--columns", nargs="*", default=None)
    a = p.parse_args(argv)
    sample_rows = min(max(a.sample_rows, 0), 20)

    try:
        try:
            import pandas  # noqa: F401
        except ImportError:
            raise PeekError("pandas is not installed for this Python. Set PI_BOOST_PYTHON or pip install pandas")
        if a.source.strip().lower() == "sql":
            df, total, capped, kind = load_sql(a.query, env_int("PI_BOOST_PEEK_SQL_ROWS", 50_000))
            label = "database"
        else:
            df, total, capped, kind = load_file(a.source, env_int("PI_BOOST_PEEK_MAX_ROWS", 1_000_000))
            label = Path(a.source).name
        print(build_report(df, total, capped, kind, label, sample_rows, a.columns))
        return 0
    except PeekError as e:
        print(f"data_peek: {e}", file=sys.stderr)
        return 1
    except Exception as e:
        msg = scrub(f"{type(e).__name__}: {e}", os.environ.get("PI_BOOST_DB_URL", ""))
        print(f"data_peek: unexpected error: {msg[:500]}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
