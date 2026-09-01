"""Guard against the failure mode where a boolean destroys the model and every
other gate reports success. Reproduced live on Blender 5.2.1: DIFFERENCE with a
strictly larger tool leaves tri_count=0, volume=0, bbox 0/0/0 - and
non_manifold_edges=0 plus fits_build_volume=True means nothing objects.
"""
import pytest
from printfactory.metrics import (
    degenerate_reasons, fits_build_volume, tip_risk, MIN_VIABLE_VOLUME_MM3,
)

EMPTY_STATS = {"tri_count": 0, "volume_mm3": 0.0, "non_manifold_edges": 0}
EMPTY_BBOX = {"x": 0.0, "y": 0.0, "z": 0.0}

REAL_STATS = {"tri_count": 2040, "volume_mm3": 219410.0, "non_manifold_edges": 0}
REAL_BBOX = {"x": 104.0, "y": 104.0, "z": 200.0}


def test_a_destroyed_mesh_is_flagged():
    reasons = degenerate_reasons(EMPTY_STATS, EMPTY_BBOX)
    assert reasons, "an empty mesh must never pass"
    assert any("no triangles" in r for r in reasons)


def test_a_real_part_is_not_flagged():
    assert degenerate_reasons(REAL_STATS, REAL_BBOX) == []


def test_partially_destroyed_mesh_is_caught_even_with_a_real_bbox():
    """The nastier case: geometry survives as a sliver, so the bbox looks sane
    and tip_risk does not raise - it would report ok=true with no warnings."""
    sliver = {"tri_count": 12, "volume_mm3": 0.0001, "non_manifold_edges": 0}
    bbox = {"x": 104.0, "y": 104.0, "z": 200.0}
    assert fits_build_volume(bbox) is True          # existing gates are happy
    assert tip_risk(bbox["z"], bbox["x"]) is False  # ...and so is this one
    reasons = degenerate_reasons(sliver, bbox)
    assert reasons, "a near-zero-volume sliver must be rejected"
    assert any("below the viable minimum" in r for r in reasons)


def test_zero_dimension_bbox_is_flagged():
    flat = {"tri_count": 100, "volume_mm3": 500.0, "non_manifold_edges": 0}
    reasons = degenerate_reasons(flat, {"x": 50.0, "y": 50.0, "z": 0.0})
    assert any("zero dimension" in r for r in reasons)


def test_the_existing_gates_alone_would_have_passed_the_empty_mesh():
    """Documents exactly why this module exists: without degenerate_reasons,
    nothing in the pipeline objects to a destroyed model."""
    assert EMPTY_STATS["non_manifold_edges"] == 0     # no warning
    assert fits_build_volume(EMPTY_BBOX) is True      # no warning
    with pytest.raises(ValueError, match="base_width_mm must be positive"):
        tip_risk(EMPTY_BBOX["z"], min(EMPTY_BBOX["x"], EMPTY_BBOX["y"]))


def test_threshold_is_one_cubic_mm():
    assert MIN_VIABLE_VOLUME_MM3 == 1.0
