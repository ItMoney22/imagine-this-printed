"""End-to-end qr_plaque: shells out to real Blender and checks the STL it wrote.

Skipped wholesale when $BLENDER is unset, so CI boxes without Blender stay green.
"""
import json
import os
import shutil
import struct
import subprocess
import tempfile

import pytest

from printfactory.qr import qr_matrix

BLENDER = os.environ.get("BLENDER")
if not BLENDER or not os.path.exists(BLENDER):
    pytest.skip("BLENDER not set or not found; skipping Blender integration tests",
                allow_module_level=True)

PREP = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                    "prep.py")

PAYLOAD = "https://itp.link/r1"
MODULE_MM = 1.6
BASE_MM = 3.0
POCKET_MM = 0.8
MATRIX = qr_matrix(PAYLOAD)
SIZE_MM = len(MATRIX) * MODULE_MM

# segno is absent from Blender's bundled Python, so the matrix is computed out
# here and handed over as plain data - the same way any real caller must.
SPEC = {"fixture": "qr_plaque",
        "params": {"payload": PAYLOAD, "matrix": MATRIX,
                   "module_mm": MODULE_MM, "base_thickness": BASE_MM,
                   "pocket_depth": POCKET_MM}}


def run_spec(spec: dict) -> tuple[dict, str]:
    """Run prep.py under headless Blender. Returns (metrics, out_dir)."""
    work = tempfile.mkdtemp(prefix="printfactory-qr-it-")
    spec_path = os.path.join(work, "spec.json")
    out_dir = os.path.join(work, "out")
    with open(spec_path, "w") as fh:
        json.dump(spec, fh)

    proc = subprocess.run(
        # --python-exit-code 1 is REQUIRED: without it Blender exits 0 even when
        # the script raises, so a crashed job looks like a successful one.
        [BLENDER, "--background", "--factory-startup", "--python-exit-code", "1",
         "--python", PREP,
         "--", "--spec", spec_path, "--out", out_dir],
        capture_output=True, text=True, timeout=300,
    )
    detail = f"\n--- stdout ---\n{proc.stdout}\n--- stderr ---\n{proc.stderr}"
    assert proc.returncode == 0, f"blender exited {proc.returncode}{detail}"
    metrics_path = os.path.join(out_dir, "metrics.json")
    assert os.path.exists(metrics_path), f"no metrics.json written{detail}"
    with open(metrics_path) as fh:
        return json.load(fh), out_dir


@pytest.fixture(scope="module")
def built():
    """One real Blender run shared by the assertions below. A plaque takes
    seconds to cut, so it is not re-run per test."""
    metrics, out_dir = run_spec(SPEC)
    yield metrics, out_dir
    shutil.rmtree(os.path.dirname(out_dir), ignore_errors=True)


def test_plaque_is_manifold(built):
    metrics, _ = built
    assert metrics["non_manifold_edges"] == 0
    assert metrics["manifold"] is True


def test_plaque_passes_every_gate(built):
    metrics, _ = built
    assert metrics["fits_build_volume"] is True
    assert metrics["ok"] is True, f"warnings: {metrics['warnings']}"


def test_stl_file_is_actually_written(built):
    _, out_dir = built
    stl = os.path.join(out_dir, "model.stl")
    assert os.path.exists(stl), f"model.stl missing from {out_dir}"
    assert os.path.getsize(stl) > 0, "model.stl is empty"


def test_bbox_matches_the_computed_plaque_size(built):
    metrics, _ = built
    assert metrics["bbox_mm"]["x"] == pytest.approx(SIZE_MM, abs=0.05)
    assert metrics["bbox_mm"]["y"] == pytest.approx(SIZE_MM, abs=0.05)
    assert metrics["bbox_mm"]["z"] == pytest.approx(BASE_MM, abs=0.05)


def test_the_cut_did_not_empty_the_mesh(built):
    """A boolean without use_self returns an EMPTY mesh, and an empty mesh is
    manifold, fits the build volume and reports ok. Volume is what catches it."""
    metrics, _ = built
    solid = SIZE_MM * SIZE_MM * BASE_MM
    cut = sum(sum(r) for r in MATRIX) * MODULE_MM * MODULE_MM * POCKET_MM
    assert metrics["volume_mm3"] == pytest.approx(solid - cut, rel=0.01)


def _upward_triangles(path):
    data = open(path, "rb").read()
    ntri = struct.unpack("<I", data[80:84])[0]
    out = []
    for i in range(ntri):
        off = 84 + i * 50
        nz = struct.unpack("<3f", data[off:off + 12])[2]
        vs = struct.unpack("<9f", data[off + 12:off + 48])
        if nz > 0.9:
            out.append(((vs[0], vs[1]), (vs[3], vs[4]), (vs[6], vs[7]), vs[2]))
    return out


def _contains(p, a, b, c):
    d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
    if abs(d) < 1e-12:
        return False
    l1 = ((b[1] - c[1]) * (p[0] - c[0]) + (c[0] - b[0]) * (p[1] - c[1])) / d
    l2 = ((c[1] - a[1]) * (p[0] - c[0]) + (a[0] - c[0]) * (p[1] - c[1])) / d
    return l1 >= -1e-9 and l2 >= -1e-9 and (1 - l1 - l2) >= -1e-9


def test_pocket_pattern_is_the_qr_code_and_is_not_mirrored(built):
    """Scannability is the product. A mirrored or rotated code is geometrically
    perfect and commercially worthless, and nothing else here would catch it, so
    the code is read back out of the STL and compared module by module."""
    _, out_dir = built
    tops = _upward_triangles(os.path.join(out_dir, "model.stl"))
    half = SIZE_MM / 2.0
    recovered = []
    for r in range(len(MATRIX)):
        row = []
        for c in range(len(MATRIX)):
            p = (-half + (c + 0.5) * MODULE_MM, half - (r + 0.5) * MODULE_MM)
            z = max((t[3] for t in tops if _contains(p, t[0], t[1], t[2])),
                    default=None)
            row.append(1 if z is not None and abs(z - (BASE_MM - POCKET_MM)) < 0.05
                       else 0)
        recovered.append(row)
    assert recovered == MATRIX
