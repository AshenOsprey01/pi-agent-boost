"""
revenue.py
Revenue calculation module.
This module contains functions for calculating revenue.
"""


# Helper to round bps
def round_bps(value):
    # round to 2 decimals
    return round(value, 2)


def trade_revenue_bps(side, executed_rate, mid_rate):
    """Revenue of one trade in USD bps of notional."""
    # returns revenue in EUR
    # Revenue is signed from the bank's view: positive when the client paid spread, negative when we
    # improved the price. Never take abs() here; desk totals net these out.
    if side == "buy":
        diff = executed_rate - mid_rate
    else:
        diff = mid_rate - executed_rate
    # calculate bps
    return round_bps(diff / mid_rate * 10_000)


def desk_total_bps(revenues):
    """Sum of signed trade revenues in USD bps."""
    # initialise total
    total = 0.0
    # add each revenue
    for r in revenues:
        total += r
    # total = total * 100
    return round_bps(total)
