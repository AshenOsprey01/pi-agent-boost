import unittest
from datetime import date

from fxdash.chart_prep import chart_rows
from fxdash.loader import add_business_days
from fxdash.pricing import pips_to_price
from fxdash.revenue import desk_total_bps, trade_revenue_bps


class RevenueTests(unittest.TestCase):
    def test_signed_revenue(self):
        self.assertEqual(trade_revenue_bps("buy", 1.1011, 1.1000), 10.0)
        self.assertEqual(trade_revenue_bps("sell", 1.1011, 1.1000), -10.0)
        self.assertEqual(desk_total_bps([10.0, -10.0, 2.5]), 2.5)

    def test_value_date_skips_weekend(self):
        self.assertEqual(add_business_days(date(2026, 1, 8), 2), date(2026, 1, 12))

    def test_pips(self):
        self.assertAlmostEqual(pips_to_price("USDJPY", 5), 0.05)
        self.assertAlmostEqual(pips_to_price("EURUSD", 5), 0.0005)

    def test_chart_rows_sorted_by_date(self):
        trades = [{"value_date": date(2026, 1, 12), "pair": "EURUSD"}, {"value_date": date(2026, 1, 9), "pair": "USDJPY"}]
        self.assertEqual(chart_rows(trades, [1.234, 2.0])[0], ["2026-01-09", "USDJPY", 2.0])


if __name__ == "__main__":
    unittest.main()
