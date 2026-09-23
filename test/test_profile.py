"""Tests for extensions/data-peek/profile.py. Run: .venv/Scripts/python test/test_profile.py
Needs the fixtures from test/make_fixtures.py.
"""

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "extensions/data-peek/profile.py"
FIX = ROOT / "test/fixtures"
TMP = ROOT / "test/tmp"
sys.path.insert(0, str(SCRIPT.parent))
import profile as prof  # noqa: E402  (our profile.py, not the stdlib one)

assert hasattr(prof, "check_select"), "imported the wrong 'profile' module"


def run(*args, env=None):
    e = {**os.environ, "PI_BOOST_DB_URL": f"sqlite:///{TMP / 'fx.db'}", **(env or {})}
    r = subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True, encoding="utf-8", env=e)
    return r.returncode, r.stdout, r.stderr


failures = 0


def check(name, cond, info=""):
    global failures
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"\n    {info[:300]}"))
    failures += 0 if cond else 1


csv = str(FIX / "fx_trades.csv")

# Happy paths, each under the 4 KB cap.
for label, args in {
    "csv": ["--source", csv],
    "parquet": ["--source", str(FIX / "fx_trades.parquet")],
    "sql table": ["--source", "sql", "--query", "fx_trades"],
    "sql query": ["--source", "sql", "--query", "SELECT desk, COUNT(*) AS n FROM fx_trades GROUP BY desk"],
}.items():
    code, out, err = run(*args)
    check(f"{label}: ok and <= 4 KB", code == 0 and 0 < len(out.encode()) <= 4096, err or out)

code, out, _ = run("--source", csv)
check("csv: duplicate row counted", "duplicate rows: 1" in out, out)
check("csv: text dates flagged", "trade_date  [str]" in out and "parses as dates" in out.split("trade_date")[1].split("\n")[0], out)
check("csv: ids not flagged as dates", "FLAG" not in out.split("- trade_id")[1].split("\n")[0], out)
check("csv: low-card top values", "top: GBPUSD" in out, out)
check("csv: nulls reported", "revenue_bps  [float64]  nulls 1%" in out, out)

# Row cap.
code, out, _ = run("--source", csv, env={"PI_BOOST_PEEK_MAX_ROWS": "50"})
check("row cap stated", "profiled the first 50 rows" in out and "more than 50" in out, out)

# Column filter + unknown column.
code, out, _ = run("--source", csv, "--columns", "rate", "desk", "--sample-rows", "0")
check("columns filter", "x 2 columns" in out and "sample" not in out, out)
code, _, err = run("--source", csv, "--columns", "nope")
check("unknown column -> clear error", code == 1 and "unknown column" in err and "Available" in err, err)

# Errors.
code, _, err = run("--source", "does/not/exist.csv")
check("missing file -> clear error", code == 1 and "file not found" in err, err)
TMP.mkdir(exist_ok=True)
(TMP / "notes.docx").write_text("x")
code, _, err = run("--source", str(TMP / "notes.docx"))
check("unsupported file type -> clear error", code == 1 and "unsupported file type" in err, err)
for q in ["DELETE FROM fx_trades", "SELECT 1; DROP TABLE fx_trades", "WITH x AS (SELECT 1) DELETE FROM fx_trades",
          "UPDATE fx_trades SET rate = 0", "SELECT * INTO copy FROM fx_trades"]:
    code, _, err = run("--source", "sql", "--query", q)
    check(f"refused: {q[:35]}", code == 1 and "refused" in err, err)
code, _, err = run("--source", "sql", "--query", "SELECT 'delete me; now' AS s -- drop")
check("string/comment content not refused", code == 0, err)
code, _, err = run("--source", "sql", "--query", "fx_trades", env={"PI_BOOST_DB_URL": ""})
check("no DB URL -> clear error", code == 1 and "PI_BOOST_DB_URL" in err, err)
code, _, err = run("--source", "sql", "--query", "no_such_table")
check("missing table -> error", code == 1 and "no_such_table" in err, err)

# Credential scrubbing.
url = "postgresql://analyst:s3cretPW@db.example.internal:5432/mkt"
msg = prof.scrub(f"could not connect using {url} (password=s3cretPW)", url)
check("scrub removes URL and password", "s3cretPW" not in msg and "analyst" not in msg, msg)
check("scrub handles ODBC strings", "hunter2" not in prof.scrub("DSN=x;UID=a;PWD=hunter2;", ""))

# Numeric-as-text + wide table truncation.
import pandas as pd  # noqa: E402

TMP.mkdir(exist_ok=True)
pd.DataFrame({"amt": ["1,000", "2,500", "(300)", "4,000"], "d": ["05/01/2026"] * 4}).to_csv(TMP / "text_nums.csv", index=False)
code, out, _ = run("--source", str(TMP / "text_nums.csv"))
check("numeric stored as text flagged", "numeric stored as text" in out, out)
check("dd/mm/yyyy dates flagged", "parses as dates" in out.split("- d ")[1], out)
pd.DataFrame({f"column_number_{i}": range(3) for i in range(150)}).to_csv(TMP / "wide.csv", index=False)
code, out, _ = run("--source", str(TMP / "wide.csv"))
check("wide table truncated under cap with hint", len(out.encode()) <= 4096 and "columns=[...]" in out, out[-200:])

print("ALL PASS" if failures == 0 else f"{failures} FAILED")
sys.exit(1 if failures else 0)
