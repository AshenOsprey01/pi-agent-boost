# Decisions

## D1: Chart order
We sort chart rows by revenue, largest first, so the biggest trades are on top.

## D2: Signed revenue
Revenue keeps its sign (client paid spread = positive, price improvement = negative) so desk totals net out.

## D3: Loader library
We use pandas to read the trade CSV because it is faster.
