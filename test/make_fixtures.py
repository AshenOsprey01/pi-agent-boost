"""Generate synthetic FX test fixtures for pi-agent-boost.

All data is random and synthetic. Run from the repo root:
    .venv/Scripts/python test/make_fixtures.py

Writes:
    test/fixtures/fx_trades.csv      trade_date stored as text, some nulls, one duplicate row
    test/fixtures/fx_trades.parquet  same data (needs pyarrow)
    test/tmp/fx.db                   SQLite DB with table fx_trades (for data_peek SQL mode)
"""

import random
import sqlite3
from datetime import date, timedelta
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent
FIX = ROOT / "fixtures"
TMP = ROOT / "tmp"


def build() -> pd.DataFrame:
    rng = random.Random(42)
    pairs = {"EURUSD": 1.08, "USDJPY": 150.0, "GBPUSD": 1.27}
    desks = ["FX Spot", "FX Options", "Rates Swaps"]
    start = date(2026, 1, 5)
    rows = []
    for i in range(1, 201):
        pair = rng.choice(list(pairs))
        mid = pairs[pair]
        trade_date = start + timedelta(days=rng.randint(0, 60))
        rows.append(
            {
                "trade_id": f"T{i:05d}",
                "trade_date": trade_date.isoformat(),  # text on purpose
                "value_date": (trade_date + timedelta(days=2)).isoformat(),
                "ccy_pair": pair,
                "side": rng.choice(["BUY", "SELL"]),
                "notional": round(rng.uniform(1e5, 5e7), 2),
                "notional_ccy": pair[:3],
                "rate": round(mid * rng.uniform(0.98, 1.02), 5 if "JPY" not in pair else 3),
                "revenue_bps": round(rng.uniform(-2, 8), 2),
                "desk": rng.choice(desks),
            }
        )
    df = pd.DataFrame(rows)
    # Some nulls.
    for idx in (7, 33, 90):
        df.loc[idx, "revenue_bps"] = None
    df.loc[55, "desk"] = None
    # One exact duplicate row.
    df = pd.concat([df, df.iloc[[10]]], ignore_index=True)
    return df


def main() -> None:
    FIX.mkdir(exist_ok=True)
    TMP.mkdir(exist_ok=True)
    df = build()
    df.to_csv(FIX / "fx_trades.csv", index=False)
    try:
        df.to_parquet(FIX / "fx_trades.parquet", index=False)
    except ImportError:
        print("pyarrow missing: skipped parquet")
    db = TMP / "fx.db"
    if db.exists():
        db.unlink()
    with sqlite3.connect(db) as con:
        df.to_sql("fx_trades", con, index=False)
    print(f"wrote {len(df)} rows to csv, parquet, and {db}")


if __name__ == "__main__":
    main()
