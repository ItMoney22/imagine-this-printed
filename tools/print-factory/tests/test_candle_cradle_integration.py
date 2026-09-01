"""End-to-end candle_cradle: shells out to real Blender and checks the mesh.

Same invocation pattern as test_runner_integration.py, including the mandatory
--python-exit-code 1. Unlike the cube, this fixture runs three EXACT booleans,
so the run is shared across the module rather than repeated per assertion.
"""
import json
import os
import shutil
import subprocess
import tempfile

import pytest

BLENDER = os.environ.get("BLENDER")
if not BLENDER or not os.path.exists(BLENDER):
    pytest.skip("BLENDER not set or not found; skipping Blender integration tests",
                allow_module_level=True)

PREP = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                    "prep.py")

# The M size: the 89mm standard 3.5" reference jar, everything else defaulted.
M_SPEC = {"fixture": "candle_cradle", "params": {"jar_dia": 89}}
M_HEIGHT = 200.0
M_BASE_WIDTH = 104.0   # jar_dia + the 15mm default tipping margin


def _run_spec(spec: dict, work: str) -> dict:
    spec_path = os.path.join(work, "spec.json")
    out_dir = os.path.join(work, "out")
    with open(spec_path, "w") as fh:
        json.dump(spec, fh)

    proc = subprocess.run(
        # --python-exit-code 1 is REQUIRED: without it Blender exits 0 on an
        # uncaught exception and a crashed job looks like a successful one.
        [BLENDER, "--background", "--factory-startup", "--python-exit-code", "1",
         "--python", PREP,
         "--", "--spec", spec_path, "--out", out_dir],
        capture_output=True, text=True, timeout=600,
    )
    detail = f"\n--- stdout ---\n{proc.stdout}\n--- stderr ---\n{proc.stderr}"
    assert proc.returncode == 0, f"blender exited {proc.returncode}{detail}"
    metrics_path = os.path.join(out_dir, "metrics.json")
    assert os.path.exists(metrics_path), f"no metrics.json written{detail}"
    with open(metrics_path) as fh:
        return json.load(fh)


@pytest.fixture(scope="module")
def built_m():
    work = tempfile.mkdtemp(prefix="printfactory-cradle-")
    try:
        yield _run_spec(M_SPEC, work), os.path.join(work, "out")
    finally:
        shutil.rmtree(work, ignore_errors=True)


def test_cradle_is_manifold(built_m):
    """Three EXACT booleans against each other is exactly where this breaks."""
    metrics, _ = built_m
    assert metrics["non_manifold_edges"] == 0
    assert metrics["manifold"] is True


def test_cradle_fits_the_build_volume(built_m):
    metrics, _ = built_m
    assert metrics["fits_build_volume"] is True


def test_cradle_height_matches_the_spec(built_m):
    metrics, _ = built_m
    assert metrics["bbox_mm"]["z"] == pytest.approx(M_HEIGHT, abs=0.1)


def test_cradle_footprint_matches_base_width(built_m):
    metrics, _ = built_m
    assert metrics["bbox_mm"]["x"] == pytest.approx(M_BASE_WIDTH, abs=0.1)
    assert metrics["bbox_mm"]["y"] == pytest.approx(M_BASE_WIDTH, abs=0.1)


def test_cradle_mass_is_physically_plausible(built_m):
    """A 200mm hollowed PLA holder is hundreds of grams. 5g means the cavities
    inverted the normals; 5000g means nothing got hollowed at all."""
    metrics, _ = built_m
    assert 50 < metrics["grams_est"] < 900, metrics


def test_cradle_stl_is_written(built_m):
    _, out_dir = built_m
    stl = os.path.join(out_dir, "model.stl")
    assert os.path.exists(stl), f"model.stl missing from {out_dir}"
    assert os.path.getsize(stl) > 0, "model.stl is empty"


def test_cradle_run_is_clean(built_m):
    metrics, _ = built_m
    assert metrics["warnings"] == []
    assert metrics["ok"] is True
