# AGENTS.md - Instructions for AI agents

Welcome, agent! Please read this whole file carefully before doing anything.

## Project overview
This project is an FX revenue dashboard. It loads FX trades, computes revenue, prepares chart data
and shows it in a small web page. It is written in Python and JavaScript.

## File structure
```
fxdash/
├── __init__.py
├── loader.py       - loads trades (uses pandas)
├── revenue.py      - revenue functions
├── pricing.py      - pricing helpers
└── chart_prep.py   - chart data
web/
├── index.html
├── dashboard.js
└── api.js
tests/
└── test_revenue.py
```

## Functions
- `load_trades(path)` - loads trades from CSV
- `add_business_days(start, days)` - adds business days
- `trade_revenue_bps(side, executed_rate, mid_rate)` - revenue of one trade
- `desk_total_bps(revenues)` - desk total
- `pip_size(pair)` - pip size
- `pips_to_price(pair, pips)` - pips to price
- `legacy_mid_price(bid, ask)` - mid price
- `chart_rows(trades, revenues)` - chart rows
- `round_bps(value)` - rounding helper
- `fetchRows(url)` - JS fetch helper
- `render(el)` - JS render

## Conventions
- All revenue figures are in USD basis points (bps) of notional. Never mix in percent or other currencies.
- Always write docstrings and comments for every function and every block of code.
- Always update PLAN.md, TODO.md, CHANGELOG.md and notes/progress.md after every change.
- Use pandas for all data loading.

## Current status
- Phase 2 in progress: chart sorting (see PLAN.md)
- Next: holidays for value dates

## Rules
- Be careful.
- Write clean code.
- Test your changes.
