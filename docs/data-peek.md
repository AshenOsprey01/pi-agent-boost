# Data Peek

**Files:** `extensions/data-peek/index.ts` (tool wrapper), `extensions/data-peek/profile.py` (the profiler)

## Why
Agents guess column names, types, units, and date formats, and then you correct them. With
`data_peek`, **the data describes itself**, so no notes or md files are needed. It also saves tokens:
one ~2–4 KB profile replaces dumping a file or running many exploratory queries.

## How it works
The model calls the `data_peek` tool (its description says: profile before writing code or SQL
that touches a dataset). The extension runs `profile.py` with Python and returns its text output.

| Parameter | Meaning |
|---|---|
| `source` | File path (`.csv .tsv .parquet .xlsx .json .jsonl`) relative to cwd, or `"sql"` |
| `query` | For `sql`: a table name (`schema.table` ok) or one `SELECT`/`WITH` statement |
| `sample_rows` | Sample rows to show (default 5, max 20) |
| `columns` | Only profile these columns (use it for wide tables) |

Output (plain text, capped at about 4 KB):
- rows × columns, a note if only the first N rows were profiled, and the duplicate-row count
- per column: dtype, null %, distinct count; numeric → min/max/mean; dates → range;
  low-cardinality text → top values with counts; other text → 3 examples
- `FLAG: text that parses as dates` and `FLAG: numeric stored as text`
- a few sample rows (cells cut to 30 characters)

Example (synthetic data):
```
source: fx_trades.csv (csv)
shape: 201 rows x 10 columns
duplicate rows: 1
columns:
- trade_date  [str]  nulls 0%  distinct 58  range 2026-01-05 .. 2026-03-06  e.g. 2026-01-12, …  FLAG: text that parses as dates
- ccy_pair  [str]  nulls 0%  distinct 3  top: GBPUSD 75, EURUSD 67, USDJPY 59
- revenue_bps  [float64]  nulls 1%  distinct 177  min -1.98  max 7.99  mean 3.0797
…
```

## SQL mode
- Needs SQLAlchemy and `PI_BOOST_DB_URL` (a SQLAlchemy URL). The URL and credentials are never
  printed; error messages are scrubbed.
- **Read-only:** only a table name or a single `SELECT`/`WITH` is accepted. Anything with
  `INSERT/UPDATE/DELETE/DROP/…`, `SELECT … INTO`, or several statements is refused. The
  connection is never committed.
- Row count uses `COUNT(*)`. The profile uses up to `PI_BOOST_PEEK_SQL_ROWS` rows (unordered).

## Config (all optional)
| Env var | Default | Meaning |
|---|---|---|
| `PI_BOOST_PYTHON` | `python` (Windows) / `python3` | Python with pandas (point it at a venv) |
| `PI_BOOST_DB_URL` | — | SQLAlchemy URL for SQL mode |
| `PI_BOOST_PEEK_MAX_ROWS` | 1,000,000 | Max file rows read |
| `PI_BOOST_PEEK_SQL_ROWS` | 50,000 | Max SQL rows fetched for profiling |

Dependencies: pandas always. pyarrow for Parquet, openpyxl for Excel, SQLAlchemy + a DB driver for
SQL. Each gives a clear "pip install …" message if it's missing.

## ADAPT points
- `profile.py` → `load_sql()` → the block marked `# ADAPT: work DB`: driver, URL format,
  `connect_args`, and SQL Server's "no ORDER BY in a subquery" rule. A non-SQL store (e.g. kdb+)
  needs its own loader that returns a DataFrame.
- `PI_BOOST_PYTHON` if the work Python with pandas is not on PATH.

## Tested
`test/test_profile.py` (29 checks: CSV, Parquet, SQL table, SQL query, 4 KB cap, row cap, column
filter, refusals, missing file, unsupported type, credential scrubbing, text numbers/dates, wide
tables). Real runs on Pi 0.84.4 and 0.87.1 (Haiku): the agent called `data_peek` before writing
pandas code, SQL mode works, and errors come back as tool errors.
