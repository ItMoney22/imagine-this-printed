# tools/print-factory/tests/test_limits.py
import pytest
from printfactory.metrics import fits_build_volume, A1_BUILD_MM, tip_risk

def test_candle_holder_fits_the_a1():
    assert fits_build_volume({"x": 95, "y": 95, "z": 200}) is True

def test_too_tall_for_the_a1_is_rejected():
    assert fits_build_volume({"x": 95, "y": 95, "z": 300}) is False

def test_a1_build_volume_is_256_cubed():
    assert A1_BUILD_MM == {"x": 256, "y": 256, "z": 256}

def test_a1_mini_ceiling_is_lower():
    assert fits_build_volume({"x": 95, "y": 95, "z": 200},
                             build={"x": 180, "y": 180, "z": 180}) is False

def test_narrow_base_under_a_tall_body_is_flagged():
    # 200mm tall on a 60mm base carrying a 2lb jar = tipping
    assert tip_risk(height_mm=200, base_width_mm=60) is True

def test_wide_base_is_safe():
    assert tip_risk(height_mm=200, base_width_mm=110) is False
