# tools/print-factory/tests/test_fixture_registry.py
import pytest
from printfactory.fixtures.base import register, get_fixture, Fixture, FixtureError

def test_registered_fixture_is_retrievable():
    @register("dummy")
    class Dummy(Fixture):
        def validate(self, params): return {"ok": True}
        def build(self, params, ctx): return None
    assert get_fixture("dummy") is Dummy

def test_unregistered_fixture_raises():
    with pytest.raises(FixtureError, match="no fixture"):
        get_fixture("nope")

def test_fixture_must_implement_build():
    with pytest.raises(TypeError):
        Fixture()  # abstract
