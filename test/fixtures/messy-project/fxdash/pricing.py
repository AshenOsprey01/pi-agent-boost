import math


def pip_size(pair):
    """Pip size for a currency pair."""
    # check the quote currency
    if pair.endswith("JPY"):
        return 0.01
    # otherwise use the default
    return 0.0001


def pips_to_price(pair, pips):
    """Price move for a number of pips."""
    # multiply pips by pip size
    return pips * pip_size(pair)


def legacy_mid_price(bid, ask):
    # old mid price calculation
    return math.fsum([bid, ask]) / 2
