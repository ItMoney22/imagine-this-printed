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


# --- degenerate output --------------------------------------------------
# A boolean can consume the entire model and leave nothing behind. The wreckage
# passes every other gate: zero edges are non-manifold when there are zero
# edges, so manifold is True, warnings is empty and ok is True. These guard the
# one failure mode that ships a 0-byte-of-geometry STL as a success.
from printfactory.metrics import degenerate_reasons
from printfactory.report import build_metrics

HEALTHY_STATS = {"volume_mm3": 219410.0, "non_manifold_edges": 0, "tri_count": 2040}
HEALTHY_BBOX = {"x": 104.0, "y": 104.0, "z": 200.0}
EATEN_STATS = {"volume_mm3": 0.0, "non_manifold_edges": 0, "tri_count": 0}
EATEN_BBOX = {"x": 0.0, "y": 0.0, "z": 0.0}


def test_a_healthy_mesh_has_no_degenerate_reasons():
    assert degenerate_reasons(HEALTHY_STATS, HEALTHY_BBOX) == []


def test_no_triangles_is_degenerate():
    stats = dict(HEALTHY_STATS, tri_count=0)
    assert any("tri_count" in r for r in degenerate_reasons(stats, HEALTHY_BBOX))


def test_a_sliver_of_volume_is_degenerate():
    stats = dict(HEALTHY_STATS, volume_mm3=0.4)
    assert any("volume" in r for r in degenerate_reasons(stats, HEALTHY_BBOX))


def test_a_flattened_axis_is_degenerate():
    bbox = dict(HEALTHY_BBOX, y=0.0)
    assert any("bbox" in r for r in degenerate_reasons(HEALTHY_STATS, bbox))


def test_an_eaten_model_reports_every_reason():
    assert len(degenerate_reasons(EATEN_STATS, EATEN_BBOX)) >= 3


def test_an_eaten_model_is_not_ok_in_the_report():
    """Without this the metrics say manifold: true, warnings: [], ok: true on a
    model that no longer exists."""
    m = build_metrics("candle_cradle", {}, EATEN_STATS, EATEN_BBOX, 1.24)
    assert m["ok"] is False
    assert m["warnings"], "an eaten model must carry a warning"
    assert m["degenerate"] is True


def test_a_healthy_model_is_not_flagged_degenerate():
    m = build_metrics("candle_cradle", {}, HEALTHY_STATS, HEALTHY_BBOX, 1.24)
    assert m["degenerate"] is False
    assert m["ok"] is True
    assert m["warnings"] == []
