import pytest
from printfactory.metrics import grams_for_volume, PLA_DENSITY

def test_grams_for_one_cubic_cm_of_pla():
    # 1000 mm3 == 1 cm3; PLA is 1.24 g/cm3
    assert grams_for_volume(1000.0) == pytest.approx(1.24)

def test_grams_scales_linearly():
    assert grams_for_volume(204_000.0) == pytest.approx(252.96, rel=1e-3)

def test_density_is_overridable_for_petg():
    # PETG ~1.27 g/cm3 - the material decision is per-product, not global
    assert grams_for_volume(1000.0, density=1.27) == pytest.approx(1.27)

def test_zero_volume_is_zero_grams():
    assert grams_for_volume(0.0) == 0.0

def test_negative_volume_is_rejected():
    # a signed mesh volume < 0 means inverted normals, not a real solid
    with pytest.raises(ValueError, match="negative"):
        grams_for_volume(-5.0)
