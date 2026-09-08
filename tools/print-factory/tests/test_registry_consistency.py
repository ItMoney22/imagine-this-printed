"""KNOWN_FIXTURES is a hand-maintained catalogue; _REGISTRY is populated at
import. They must agree, or a working fixture gets rejected by JobSpec."""
from printfactory.spec import KNOWN_FIXTURES
from printfactory.fixtures.base import _REGISTRY
import printfactory.fixtures.registry_import  # noqa: F401  (populates _REGISTRY)

def test_every_registered_fixture_is_accepted_by_the_spec():
    unknown = set(_REGISTRY) - KNOWN_FIXTURES - {"dummy"}
    assert not unknown, f"registered but rejected by JobSpec: {unknown}"

def test_every_declared_fixture_is_actually_registered():
    implemented = {"_selftest", "qr_plaque"}
    missing = implemented - set(_REGISTRY)
    assert not missing, f"declared implemented but never registered: {missing}"
