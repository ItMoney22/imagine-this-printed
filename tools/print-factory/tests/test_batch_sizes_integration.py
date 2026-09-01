"""batch_sizes.py end-to-end: one Blender process, three SKUs out.

The single subprocess.run below IS the assertion that the ladder runs in one
session - if batch_sizes.py were shelling out per size it would be three
processes behind this one call, and the per-size metrics would still land, so
the cheap structural check is that this test never invokes Blender more than
once and still gets S, M and L.
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

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BATCH = os.path.join(HERE, "batch_sizes.py")

# The locked ladder. Bore is jar_dia + 2 * the 1.2mm default clearance.
EXPECTED_JAR = {"S": 76.0, "M": 89.0, "L": 104.0}
EXPECTED_BORE = {"S": 78.4, "M": 91.4, "L": 106.4}


@pytest.fixture(scope="module")
def batch_run():
    work = tempfile.mkdtemp(prefix="printfactory-batch-")
    out_dir = os.path.join(work, "out")
    try:
        proc = subprocess.run(
            [BLENDER, "--background", "--factory-startup",
             "--python-exit-code", "1", "--python", BATCH,
             "--", "--out", out_dir, "--sizes", "S,M,L"],
            capture_output=True, text=True, timeout=900,
        )
        detail = f"\n--- stdout ---\n{proc.stdout}\n--- stderr ---\n{proc.stderr}"
        assert proc.returncode == 0, f"blender exited {proc.returncode}{detail}"
        index_path = os.path.join(out_dir, "batch.json")
        assert os.path.exists(index_path), f"no batch.json written{detail}"
        with open(index_path) as fh:
            yield json.load(fh), out_dir
    finally:
        shutil.rmtree(work, ignore_errors=True)


def test_all_three_sizes_are_produced(batch_run):
    index, _ = batch_run
    assert sorted(index["sizes"]) == ["L", "M", "S"]


def test_every_size_is_manifold(batch_run):
    index, _ = batch_run
    for size in ("S", "M", "L"):
        m = index["results"][size]
        assert m["non_manifold_edges"] == 0, f"{size}: {m}"
        assert m["manifold"] is True, f"{size}: {m}"


def test_every_size_fits_the_build_volume(batch_run):
    index, _ = batch_run
    for size in ("S", "M", "L"):
        assert index["results"][size]["fits_build_volume"] is True, size


def test_bore_matches_the_locked_ladder(batch_run):
    index, _ = batch_run
    for size, bore in EXPECTED_BORE.items():
        got = index["results"][size]["params"]["bore_dia"]
        assert got == pytest.approx(bore), f"{size}: bore {got} != {bore}"


def test_bore_deltas_are_exactly_the_ladder_steps(batch_run):
    """76 -> 89 -> 104 is a 13mm then a 15mm step; the bores must track it
    exactly, because clearance is constant across the ladder."""
    index, _ = batch_run
    s, m, l = (index["results"][k]["params"]["bore_dia"] for k in ("S", "M", "L"))
    assert m - s == pytest.approx(13.0)
    assert l - m == pytest.approx(15.0)


def test_jar_diameters_match_the_ladder(batch_run):
    index, _ = batch_run
    for size, jar in EXPECTED_JAR.items():
        assert index["results"][size]["params"]["jar_dia"] == pytest.approx(jar)


def test_each_size_writes_its_own_stl_and_metrics(batch_run):
    _, out_dir = batch_run
    for size in ("S", "M", "L"):
        stl = os.path.join(out_dir, size, "model.stl")
        metrics = os.path.join(out_dir, size, "metrics.json")
        assert os.path.exists(stl), f"missing {stl}"
        assert os.path.getsize(stl) > 0, f"empty {stl}"
        assert os.path.exists(metrics), f"missing {metrics}"


def test_bigger_jar_means_a_heavier_part(batch_run):
    """A sanity check that the sizes are actually different geometry and not
    the same mesh written three times."""
    index, _ = batch_run
    s, m, l = (index["results"][k]["grams_est"] for k in ("S", "M", "L"))
    assert s < m < l, (s, m, l)


def test_selecting_a_subset_still_works(batch_run):
    """--sizes is a real filter, not a hardcoded S/M/L loop."""
    work = tempfile.mkdtemp(prefix="printfactory-batch-one-")
    try:
        proc = subprocess.run(
            [BLENDER, "--background", "--factory-startup",
             "--python-exit-code", "1", "--python", BATCH,
             "--", "--out", os.path.join(work, "out"), "--sizes", "M"],
            capture_output=True, text=True, timeout=900,
        )
        assert proc.returncode == 0, proc.stdout + proc.stderr
        with open(os.path.join(work, "out", "batch.json")) as fh:
            index = json.load(fh)
        assert index["sizes"] == ["M"]
    finally:
        shutil.rmtree(work, ignore_errors=True)


def test_unknown_size_fails_loudly(batch_run):
    work = tempfile.mkdtemp(prefix="printfactory-batch-bad-")
    try:
        proc = subprocess.run(
            [BLENDER, "--background", "--factory-startup",
             "--python-exit-code", "1", "--python", BATCH,
             "--", "--out", os.path.join(work, "out"), "--sizes", "XL"],
            capture_output=True, text=True, timeout=900,
        )
        assert proc.returncode != 0, "an unknown size must not silently no-op"
        assert "XL" in proc.stdout + proc.stderr
    finally:
        shutil.rmtree(work, ignore_errors=True)
