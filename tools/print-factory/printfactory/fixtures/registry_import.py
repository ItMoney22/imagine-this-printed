"""Importing this module registers every fixture. prep.py imports it for the
side effect - without it the registry is empty and get_fixture() always fails."""
from printfactory.fixtures import selftest  # noqa: F401
# from printfactory.fixtures import qr_plaque      # noqa: F401  (Task 7)
# from printfactory.fixtures import candle_cradle  # noqa: F401  (Task 11)
