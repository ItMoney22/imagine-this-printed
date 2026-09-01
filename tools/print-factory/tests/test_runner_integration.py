"""End-to-end: shells out to real Blender and checks what it actually produced.

Skipped wholesale when $BLENDER is unset, so CI boxes without Blender stay green.
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


def run_spec(spec: dict) -> tuple[dict, str]:
    """Run prep.py under headless Blender. Returns (metrics, out_dir).

    Caller owns out_dir's parent cleanup via the tmp dir it lives in - tests
    below wrap this in try/finally.
    """
    work = tempfile.mkdtemp(prefix="printfactory-it-")
    spec_path = os.path.join(work, "spec.json")
    out_dir = os.path.join(work, "out")
    with open(spec_path, "w") as fh:
        json.dump(spec, fh)

    proc = subprocess.run(
        [BLENDER, "--background", "--factory-startup", "--python", PREP,
         "--", "--spec", spec_path, "--out", out_dir],
        capture_output=True, text=True, timeout=300,
    )
    detail = f"\n--- stdout ---\n{proc.stdout}\n--- stderr ---\n{proc.stderr}"
    assert proc.returncode == 0, f"blender exited {proc.returncode}{detail}"
    metrics_path = os.path.join(out_dir, "metrics.json")
    # Blender exits 0 even when the --python script raises, so the real proof
    # the run succeeded is that metrics.json exists.
    assert os.path.exists(metrics_path), f"no metrics.json written{detail}"
    with open(metrics_path) as fh:
        return json.load(fh), out_dir


CUBE_SPEC = {"fixture": "_selftest", "params": {"size_mm": 20}}


def test_20mm_cube_reports_correct_volume():
    metrics, out_dir = run_spec(CUBE_SPEC)
    try:
        assert metrics["volume_mm3"] == pytest.approx(8000, rel=0.05)
    finally:
        shutil.rmtree(os.path.dirname(out_dir), ignore_errors=True)


def test_cube_is_manifold():
    metrics, out_dir = run_spec(CUBE_SPEC)
    try:
        assert metrics["manifold"] is True
        assert metrics["non_manifold_edges"] == 0
    finally:
        shutil.rmtree(os.path.dirname(out_dir), ignore_errors=True)


def test_cube_fits_the_build_volume():
    metrics, out_dir = run_spec(CUBE_SPEC)
    try:
        assert metrics["fits_build_volume"] is True
        assert metrics["ok"] is True
    finally:
        shutil.rmtree(os.path.dirname(out_dir), ignore_errors=True)


def test_stl_file_is_actually_written():
    """metrics.json can be written even if the export silently no-ops, so the
    STL is checked on disk, not inferred."""
    _, out_dir = run_spec(CUBE_SPEC)
    try:
        stl = os.path.join(out_dir, "model.stl")
        assert os.path.exists(stl), f"model.stl missing from {out_dir}"
        assert os.path.getsize(stl) > 0, "model.stl is empty"
    finally:
        shutil.rmtree(os.path.dirname(out_dir), ignore_errors=True)


def test_grams_estimate_matches_volume():
    metrics, out_dir = run_spec(CUBE_SPEC)
    try:
        assert metrics["grams_est"] == pytest.approx(8000 / 1000 * 1.24, rel=0.05)
    finally:
        shutil.rmtree(os.path.dirname(out_dir), ignore_errors=True)
