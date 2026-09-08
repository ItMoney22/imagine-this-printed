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
        # --python-exit-code 1 is REQUIRED. Without it Blender exits 0 even when
        # the script raises an uncaught exception, so a crashed job is
        # indistinguishable from a successful one. Verified on 5.2.1:
        #   raise                        -> exit 0
        #   raise + --python-exit-code 1 -> exit 1
        # Any caller of prep.py (including Saturn over the print bridge) must
        # pass this flag or it will mark failed jobs complete with no artifacts.
        [BLENDER, "--background", "--factory-startup", "--python-exit-code", "1",
         "--python", PREP,
         "--", "--spec", spec_path, "--out", out_dir],
        capture_output=True, text=True, timeout=300,
    )
    detail = f"\n--- stdout ---\n{proc.stdout}\n--- stderr ---\n{proc.stderr}"
    assert proc.returncode == 0, f"blender exited {proc.returncode}{detail}"
    metrics_path = os.path.join(out_dir, "metrics.json")
    # Belt and braces alongside the exit code: metrics.json existing is direct
    # evidence the run reached the end, not just that the process survived.
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
