# Chart data preparation
# This file prepares data for the chart


# Helper to round bps
def round_bps(value):
    # round to 2 decimals
    return round(value, 2)


def chart_rows(trades, revenues):
    """Rows for the revenue chart, one per trade, oldest value date first."""
    rows = []
    # loop over trades and revenues
    for trade, rev in zip(trades, revenues):
        # Do not reorder these fields: the dashboard reads each row by position.
        rows.append([trade["value_date"].isoformat(), trade["pair"], round_bps(rev)])
    # sort by date
    rows.sort(key=lambda r: r[0])
    # print(rows)
    return rows
