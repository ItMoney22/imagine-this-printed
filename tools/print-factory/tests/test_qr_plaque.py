"""qr_plaque validate() - pure Python, no Blender. Geometry is covered by
tests/test_qr_plaque_integration.py."""
import pytest

from printfactory.fixtures.base import FixtureError, get_fixture
from printfactory.fixtures.qr_plaque import QRPlaque
from printfactory.qr import qr_matrix


def v(**params):
    return QRPlaque().validate(params)


def test_valid_payload_returns_a_matrix_and_a_sensible_size():
    out = v(payload="https://imaginethisprinted.com")
    assert out["matrix"] == qr_matrix("https://imaginethisprinted.com")
    assert out["size_mm"] == pytest.approx(len(out["matrix"]) * 1.6)
    # a desk plaque, not a postage stamp and not a table top
    assert 30.0 < out["size_mm"] < 120.0


def test_defaults_are_the_printable_ones():
    out = v(payload="https://example.com")
    assert out["module_mm"] == 1.6
    assert out["base_thickness"] == 3.0
    assert out["pocket_depth"] == 0.8
    assert out["ecc"] == "h"


def test_empty_payload_is_rejected():
    with pytest.raises(FixtureError, match="payload"):
        v(payload="")


def test_missing_payload_is_rejected():
    with pytest.raises(FixtureError, match="payload"):
        v(module_mm=1.6)


def test_module_below_the_scan_floor_is_rejected():
    with pytest.raises(FixtureError, match="module_mm"):
        v(payload="https://example.com", module_mm=0.8)


def test_pocket_deeper_than_the_base_would_punch_through():
    with pytest.raises(FixtureError, match="pocket_depth"):
        v(payload="https://example.com", base_thickness=3.0, pocket_depth=4.0)


def test_pocket_exactly_the_base_thickness_is_rejected():
    with pytest.raises(FixtureError, match="pocket_depth"):
        v(payload="https://example.com", base_thickness=3.0, pocket_depth=3.0)


def test_zero_pocket_has_no_contrast_and_is_rejected():
    with pytest.raises(FixtureError, match="pocket_depth"):
        v(payload="https://example.com", pocket_depth=0.0)


def test_plaque_too_big_for_the_a1_is_rejected():
    with pytest.raises(FixtureError, match="build volume"):
        v(payload="x" * 1200, module_mm=5.0)


def test_precomputed_matrix_is_used_verbatim():
    """segno is absent from Blender's bundled Python, so prep.py hands the
    matrix in as plain data rather than recomputing it."""
    m = [[0] * 5, [0, 1, 1, 0, 0], [0, 1, 0, 0, 0], [0] * 5, [0] * 5]
    out = v(payload="https://example.com", matrix=m)
    assert out["matrix"] == m
    assert out["size_mm"] == pytest.approx(5 * 1.6)


def test_fixture_is_registered_under_its_spec_name():
    import printfactory.fixtures.registry_import  # noqa: F401
    assert get_fixture("qr_plaque") is QRPlaque
