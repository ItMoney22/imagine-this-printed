"""Pure validate() tests for the candle_cradle fixture. No Blender here.

The whole point of splitting validate() out of build() is that the expensive,
failure-prone half (geometry) never runs on params that are already known to be
unbuildable. Everything below runs in milliseconds on any machine.
"""
import pytest

from printfactory.fixtures.base import FixtureError, get_fixture
from printfactory.fixtures.candle_cradle import CandleCradle


@pytest.fixture
def cradle():
    return CandleCradle()


# --- the locked size ladder -------------------------------------------------
# S/M/L are real SKUs, not arbitrary numbers: 76mm small jar, 89mm is the
# standard 3.5" reference jar, 104mm is the large 3-wick (B&BW / Yankee).

@pytest.mark.parametrize("jar_dia,expected_bore", [
    (76.0, 78.4),    # S
    (89.0, 91.4),    # M
    (104.0, 106.4),  # L
])
def test_size_ladder_validates_with_correct_bore(cradle, jar_dia, expected_bore):
    out = cradle.validate({"jar_dia": jar_dia})
    assert out["jar_dia"] == pytest.approx(jar_dia)
    assert out["bore_dia"] == pytest.approx(expected_bore)


def test_bore_is_jar_plus_two_clearances(cradle):
    out = cradle.validate({"jar_dia": 89, "clearance": 2.0})
    assert out["bore_dia"] == pytest.approx(93.0)


def test_registered_under_its_name():
    assert get_fixture("candle_cradle") is CandleCradle


# --- jar diameter has to be a real candle jar -------------------------------

def test_jar_dia_is_required(cradle):
    with pytest.raises(FixtureError, match="jar_dia"):
        cradle.validate({})


def test_jar_too_small_raises(cradle):
    with pytest.raises(FixtureError, match="jar_dia"):
        cradle.validate({"jar_dia": 40})


def test_jar_too_large_raises(cradle):
    with pytest.raises(FixtureError, match="jar_dia"):
        cradle.validate({"jar_dia": 200})


@pytest.mark.parametrize("jar_dia,height", [
    # The small end needs a shorter body: a 50mm jar's default base is 65mm and
    # the default 200mm height is a 3.08 ratio, which tip_risk correctly refuses.
    (50, 150),
    (150, 200),
])
def test_jar_dia_bounds_are_inclusive(cradle, jar_dia, height):
    out = cradle.validate({"jar_dia": jar_dia, "height": height})
    assert out["jar_dia"] == pytest.approx(jar_dia)


def test_smallest_jar_at_default_height_is_refused_as_a_tipper(cradle):
    """Not a bug: a 50mm votive on its default 65mm base at 200mm tall is a
    3.08 height/base ratio. The ladder's real S size is 76mm for this reason."""
    with pytest.raises(FixtureError, match="tip"):
        cradle.validate({"jar_dia": 50})


# --- clearance --------------------------------------------------------------

def test_zero_clearance_raises(cradle):
    with pytest.raises(FixtureError, match="clearance"):
        cradle.validate({"jar_dia": 89, "clearance": 0})


def test_negative_clearance_raises(cradle):
    with pytest.raises(FixtureError, match="clearance"):
        cradle.validate({"jar_dia": 89, "clearance": -1.0})


def test_clearance_defaults_to_1_2(cradle):
    assert cradle.validate({"jar_dia": 89})["clearance"] == pytest.approx(1.2)


# --- base width / tipping, the actual engineering risk ----------------------

def test_default_base_width_is_derived_from_jar_dia(cradle):
    assert cradle.validate({"jar_dia": 89})["base_width"] == pytest.approx(104.0)
    assert cradle.validate({"jar_dia": 76})["base_width"] == pytest.approx(91.0)


def test_base_narrower_than_jar_raises(cradle):
    with pytest.raises(FixtureError, match="base_width"):
        cradle.validate({"jar_dia": 89, "base_width": 80})


def test_base_too_narrow_to_wall_the_bore_raises(cradle):
    """base_width == jar_dia clears the 'wider than the jar' rule but the bore
    is jar+2*clearance, so the cut would eat the entire wall."""
    with pytest.raises(FixtureError, match="base_width"):
        cradle.validate({"jar_dia": 89, "base_width": 89})


def test_tall_narrow_combo_raises_tip_risk(cradle):
    with pytest.raises(FixtureError, match="tip"):
        cradle.validate({"jar_dia": 50, "height": 200, "base_width": 60})


def test_same_narrow_base_is_fine_when_short(cradle):
    """Proves the tip check is a ratio, not a base_width floor."""
    out = cradle.validate({"jar_dia": 50, "height": 140, "base_width": 60})
    assert out["height"] == pytest.approx(140)


# --- build volume -----------------------------------------------------------

def test_200mm_tall_fits_the_a1(cradle):
    assert cradle.validate({"jar_dia": 89, "height": 200})["height"] == 200


def test_300mm_tall_exceeds_the_a1(cradle):
    with pytest.raises(FixtureError, match="build volume"):
        cradle.validate({"jar_dia": 89, "height": 300, "base_width": 140})


def test_absurdly_wide_base_exceeds_the_a1(cradle):
    with pytest.raises(FixtureError, match="build volume"):
        cradle.validate({"jar_dia": 89, "height": 200, "base_width": 300})


# --- platform depth ---------------------------------------------------------

def test_platform_depth_equal_to_height_raises(cradle):
    with pytest.raises(FixtureError, match="platform_depth"):
        cradle.validate({"jar_dia": 89, "height": 25, "platform_depth": 25})


def test_platform_depth_beyond_height_raises(cradle):
    with pytest.raises(FixtureError, match="platform_depth"):
        cradle.validate({"jar_dia": 89, "height": 100, "platform_depth": 120})


def test_platform_depth_defaults_to_25(cradle):
    assert cradle.validate({"jar_dia": 89})["platform_depth"] == pytest.approx(25)


# --- weight pocket ----------------------------------------------------------

def test_weight_pocket_defaults_on_at_15mm(cradle):
    out = cradle.validate({"jar_dia": 89})
    assert out["weight_pocket"] is True
    assert out["weight_pocket_depth"] == pytest.approx(15)


def test_pocket_reaching_the_bore_raises(cradle):
    with pytest.raises(FixtureError, match="weight_pocket_depth"):
        cradle.validate({"jar_dia": 89, "height": 200, "platform_depth": 25,
                         "weight_pocket_depth": 175})


def test_pocket_depth_is_ignored_when_pocket_is_off(cradle):
    out = cradle.validate({"jar_dia": 89, "weight_pocket": False,
                           "weight_pocket_depth": 500})
    assert out["weight_pocket"] is False


# --- wall -------------------------------------------------------------------

def test_wall_below_printable_minimum_raises(cradle):
    with pytest.raises(FixtureError, match="wall_mm"):
        cradle.validate({"jar_dia": 89, "wall_mm": 0.4})


def test_wall_defaults_to_2_4(cradle):
    assert cradle.validate({"jar_dia": 89})["wall_mm"] == pytest.approx(2.4)


# --- the normalised dict is complete so build() does no arithmetic ----------

def test_validate_returns_every_key_build_needs(cradle):
    out = cradle.validate({"jar_dia": 89})
    assert set(out) == {
        "jar_dia", "clearance", "bore_dia", "height", "platform_depth",
        "base_width", "wall_mm", "weight_pocket", "weight_pocket_depth",
    }
