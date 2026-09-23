# ============================================
# File: loader.py
# Author: AI assistant
# Description: Loads FX trades from CSV files.
# ============================================
import csv
import json
from datetime import date, timedelta


# Function to add business days
def add_business_days(start, days):
    # start from the given date
    current = start
    # loop until all days are added
    while days > 0:
        current += timedelta(days=1)
        # skip weekends
        if current.weekday() < 5:
            days -= 1
    # return the result
    return current


def load_trades(path):
    """Load trades from a CSV file."""
    trades = []
    # open the file
    with open(path, newline="") as f:
        # create a reader
        reader = csv.DictReader(f)
        # loop over rows
        for row in reader:
            trade_date = date.fromisoformat(row["trade_date"])
            # Spot FX settles T+2: the value date is two business days after the trade date.
            # Revenue must be booked on the value date, not the trade date.
            value_date = add_business_days(trade_date, 2)
            # TODO: handle holidays
            # value_date = trade_date + timedelta(days=2)
            trades.append({
                "trade_id": row["trade_id"],
                "pair": row["pair"],
                "side": row["side"],
                "notional": float(row["notional"]),
                "rate": float(row["rate"]),
                "mid": float(row["mid"]),
                "value_date": value_date,
            })
    # return the list of trades
    return trades
