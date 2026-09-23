"""Revenue by currency pair, in USD, for the FX dashboard.

Reads fx_trades.csv and writes revenue_by_pair.csv.
"""

import pandas as pd

trades = pd.read_csv("fx_trades.csv", parse_dates=["trade_date"])

# Convert notional to USD using the trade rate.
trades["notional_usd"] = trades["notional"] * trades["rate"]

# Revenue = notional * revenue_bps / 10,000.
trades["revenue_usd"] = trades["notional_usd"] * trades["revenue_bps"] / 10_000

summary = (
    trades.groupby("ccy_pair", as_index=False)
    .agg(trades=("trade_id", "count"), revenue_usd=("revenue_usd", "sum"))
    .sort_values("revenue_usd", ascending=False)
)
summary["revenue_usd"] = summary["revenue_usd"].round(2)
summary.to_csv("revenue_by_pair.csv", index=False)
print(summary.to_string(index=False))
print(f"Total revenue USD: {summary['revenue_usd'].sum():,.2f}")
