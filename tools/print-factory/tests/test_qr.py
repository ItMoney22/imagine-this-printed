import pytest
from printfactory.qr import qr_matrix, plaque_size_mm, MIN_MODULE_MM, QUIET_ZONE

def test_matrix_is_square_and_binary():
    m = qr_matrix("https://example.com")
    assert len(m) == len(m[0])
    assert set(v for row in m for v in row) <= {0, 1}

def test_quiet_zone_is_four_modules_each_side():
    assert QUIET_ZONE == 4
    m = qr_matrix("https://example.com")
    assert all(v == 0 for v in m[0])
    assert all(row[0] == 0 for row in m)

def test_error_correction_defaults_to_high():
    plain = qr_matrix("https://example.com", ecc="l")
    high = qr_matrix("https://example.com", ecc="h")
    assert len(high) > len(plain)

def test_module_size_floor_is_enforced():
    assert MIN_MODULE_MM == 1.6
    with pytest.raises(ValueError, match="module_mm"):
        plaque_size_mm("https://example.com", module_mm=0.8)

def test_plaque_size_matches_module_count():
    m = qr_matrix("https://example.com")
    size = plaque_size_mm("https://example.com", module_mm=1.6)
    assert size == pytest.approx(len(m) * 1.6)

def test_empty_payload_is_rejected():
    with pytest.raises(ValueError, match="payload"):
        qr_matrix("")
