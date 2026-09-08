"""Fixture interface.

A fixture is a GEOMETRY PROGRAM. Given params it returns exact, printable
functional geometry - mm units, Z-up, resting on Z=0. It never guesses.

`validate` is pure (no Blender) so it is unit-testable on any machine.
`build` runs only inside Blender.
"""
from abc import ABC, abstractmethod

class FixtureError(Exception):
    pass

_REGISTRY: dict[str, type] = {}

def register(name: str):
    def deco(cls):
        _REGISTRY[name] = cls
        return cls
    return deco

def get_fixture(name: str) -> type:
    if name not in _REGISTRY:
        raise FixtureError(f"no fixture registered as {name!r}")
    return _REGISTRY[name]

class Fixture(ABC):
    @abstractmethod
    def validate(self, params: dict) -> dict:
        """Normalise + range-check params. Pure Python. Raises FixtureError."""

    @abstractmethod
    def build(self, params: dict, ctx):
        """Return a Blender mesh object. Called inside Blender only."""
