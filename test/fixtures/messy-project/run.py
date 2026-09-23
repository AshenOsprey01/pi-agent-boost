import sys

from fxdash.chart_prep import chart_rows
from fxdash.loader import load_trades
from fxdash.revenue import desk_total_bps, trade_revenue_bps


def main(path):
    trades = load_trades(path)
    revenues = [trade_revenue_bps(t["side"], t["rate"], t["mid"]) for t in trades]
    for row in chart_rows(trades, revenues):
        print(*row)
    print("desk total bps:", desk_total_bps(revenues))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "data/sample_trades.csv")
