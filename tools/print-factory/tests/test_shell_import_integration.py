"""The real GLB, through real Blender: import, join, normalise.

Runs against tools/print-factory/examples/shell.glb - a TRELLIS output, so a
genuinely broken mesh (15,658 non-manifold edges on 39,434 triangles). That
brokenness is the point: it is why voxel_remesh has to run before any boolean,
and these tests pin the raw numbers so a silent change in the importer or in
the file itself shows up here rather than in a failed print.
"""
import json
import os
import subprocess

import pytest

BLENDER = os.environ.get("BLENDER")
if not BLENDER or not os.path.exists(BLENDER):
    pytest.skip("BLENDER not set or not found; skipping Blender integration tests",
                allow_module_level=True)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHELL = os.path.join(ROOT, "examples", "shell.glb")
if not os.path.exists(SHELL):
    pytest.skip(f"examples/shell.glb not present ({SHELL}); it is a generated "
                "artifact and deliberately not committed",
                allow_module_level=True)

TARGET_H = 200.0

# One Blender launch, everything measured, printed as JSON on a marked line.
EXPR = f"""
import sys, json
sys.path.insert(0, {ROOT!r})
from printfactory import blender_ops as ops
ops.clear_scene()
obj = ops.import_glb({SHELL!r})
raw = dict(ops.mesh_stats(obj))
raw_bbox = ops.bbox_mm(obj)
mesh_objects = len([o for o in __import__('bpy').data.objects if o.type == 'MESH'])
plan = ops.normalise_shell(obj, {TARGET_H})
mn, mx = ops.bounds_mm(obj)
print('RESULT' + json.dumps({{
    'raw': raw, 'raw_bbox': raw_bbox, 'mesh_objects': mesh_objects,
    'plan': plan, 'bbox': ops.bbox_mm(obj), 'min': mn, 'max': mx,
    'stats': ops.mesh_stats(obj),
}}))
"""


@pytest.fixture(scope="module")
def imported():
    proc = subprocess.run(
        [BLENDER, "--background", "--factory-startup", "--python-exit-code", "1",
         "--python-expr", EXPR],
        capture_output=True, text=True, timeout=600,
    )
    detail = f"\n--- stdout ---\n{proc.stdout}\n--- stderr ---\n{proc.stderr}"
    assert proc.returncode == 0, f"blender exited {proc.returncode}{detail}"
    line = [l for l in proc.stdout.splitlines() if l.startswith("RESULT")]
    assert line, f"no RESULT line{detail}"
    return json.loads(line[-1][len("RESULT"):])


def test_the_scene_collapses_to_a_single_mesh(imported):
    """The GLB carries a mesh plus a 'world' EMPTY. Everything downstream takes
    one object, so the import has to hand back one object."""
    assert imported["mesh_objects"] == 1


def test_the_raw_shell_is_as_broken_as_advertised(imported):
    """39,434 tris / 15,658 non-manifold edges, measured. If this ever comes
    back clean, the file was swapped and the remesh assumptions need re-checking."""
    assert imported["raw"]["tri_count"] == 39434
    assert imported["raw"]["non_manifold_edges"] == 15658


def test_the_importer_already_puts_the_height_on_z(imported):
    """glTF stores this model's 1.0016-unit height on +Y (raw POSITION accessor
    min/max: y -0.50101..0.50060). Blender hands it back on +Z, which is the
    same makeRotationX(-pi/2) glb-to-stl.ts applies - so we must NOT rotate
    again. This test is the proof, not a comment."""
    b = imported["raw_bbox"]
    assert b["z"] == pytest.approx(1.0016, abs=1e-3)
    assert b["z"] > b["x"] and b["z"] > b["y"], "model imported lying down"


def test_scaled_to_the_target_height(imported):
    assert imported["bbox"]["z"] == pytest.approx(TARGET_H, abs=1e-4)


# Blender stores vertex coordinates as float32, so a 110mm part carries ~2e-6mm
# of representation error after a scale-then-translate. That is two nanometres:
# four orders of magnitude under a 0.4mm nozzle, and it is the data type, not
# the maths - shellprep's own tests hold the transform to 1e-9 in float64.
PLACEMENT_TOL_MM = 1e-3


def test_rests_on_the_build_plate(imported):
    assert imported["min"][2] == pytest.approx(0.0, abs=PLACEMENT_TOL_MM)


def test_centred_on_xy(imported):
    mn, mx = imported["min"], imported["max"]
    assert (mn[0] + mx[0]) / 2 == pytest.approx(0.0, abs=PLACEMENT_TOL_MM)
    assert (mn[1] + mx[1]) / 2 == pytest.approx(0.0, abs=PLACEMENT_TOL_MM)


def test_the_footprint_follows_from_the_uniform_scale(imported):
    """109.57 x 112.94 at 200mm tall. Not a choice - the shell's own
    proportions, and the number the fixture has to be unioned against."""
    assert imported["bbox"]["x"] == pytest.approx(109.57, abs=0.05)
    assert imported["bbox"]["y"] == pytest.approx(112.94, abs=0.05)


def test_normalising_does_not_repair_the_mesh(imported):
    """Scaling is not healing. The shell is still non-manifold going into the
    remesh, which is exactly why the remesh is not optional."""
    assert imported["stats"]["non_manifold_edges"] == 15658


# --- fit modes, against BOTH real shells ------------------------------------
# The tall shell is slim (0.548 wide on a 1.002 height) and the wide one is
# squat (1.001 wide on a 0.584 height, ratio 1.714). Same code path, opposite
# binding constraint - which is the entire point of fit="bbox", and is not
# something the pure tests can prove about the actual files on disk.

WIDE = os.path.join(ROOT, "examples", "shell2.glb")

FIT_EXPR = """
import sys, json
sys.path.insert(0, {root!r})
from printfactory import blender_ops as ops
out = {{}}
for name, path, target, fit in {jobs!r}:
    ops.clear_scene()
    obj = ops.import_glb(path)
    raw = ops.bbox_mm(obj)
    plan = ops.normalise_shell(obj, target, fit=fit)
    out[name] = {{'raw': raw, 'plan_scale': plan['scale'],
                 'bound_by': plan['bound_by'], 'bbox': ops.bbox_mm(obj)}}
print('RESULT' + json.dumps(out))
"""


@pytest.fixture(scope="module")
def fits():
    if not os.path.exists(WIDE):
        pytest.skip("examples/shell2.glb not present (generated artifact)")
    jobs = [
        ("tall_height", SHELL, 200.0, "height"),
        ("tall_bbox", SHELL, 200.0, "bbox"),
        ("wide_height", WIDE, 150.0, "height"),
        ("wide_bbox", WIDE, 150.0, "bbox"),
    ]
    proc = subprocess.run(
        [BLENDER, "--background", "--factory-startup", "--python-exit-code", "1",
         "--python-expr", FIT_EXPR.format(root=ROOT, jobs=jobs)],
        capture_output=True, text=True, timeout=600,
    )
    detail = f"\n--- stdout ---\n{proc.stdout}\n--- stderr ---\n{proc.stderr}"
    assert proc.returncode == 0, f"blender exited {proc.returncode}{detail}"
    line = [l for l in proc.stdout.splitlines() if l.startswith("RESULT")]
    assert line, f"no RESULT line{detail}"
    return json.loads(line[-1][len("RESULT"):])


def test_the_wide_shell_really_is_wider_than_it_is_tall(fits):
    raw = fits["wide_bbox"]["raw"]
    assert raw["x"] / raw["z"] == pytest.approx(1.7144, abs=0.001)


def test_the_tall_shell_binds_on_height_in_both_modes(fits):
    """Slim enough that the build volume never binds it, so bbox mode must be
    a no-op - existing products cannot move just because the mode exists."""
    assert fits["tall_height"]["bound_by"] == "height"
    assert fits["tall_bbox"]["bound_by"] == "height"
    assert fits["tall_bbox"]["plan_scale"] == pytest.approx(
        fits["tall_height"]["plan_scale"], rel=1e-9)
    assert fits["tall_bbox"]["bbox"]["z"] == pytest.approx(200.0, abs=0.01)


def test_the_wide_shell_binds_on_width_in_bbox_mode(fits):
    assert fits["wide_bbox"]["bound_by"] == "x"


def test_height_mode_would_have_shipped_an_unprintable_wide_part(fits):
    """The bug this feature exists to stop: a perfectly legal 150mm height on
    the wide shell produces a 257mm width, and nothing downstream notices until
    fits_build_volume fails after the remesh and every boolean is paid for."""
    assert fits["wide_height"]["bbox"]["z"] == pytest.approx(150.0, abs=0.01)
    assert fits["wide_height"]["bbox"]["x"] > 256.0


def test_bbox_mode_brings_the_wide_shell_inside_the_build_volume(fits):
    bbox = fits["wide_bbox"]["bbox"]
    assert bbox["x"] <= 256.0
    assert bbox["y"] <= 256.0
    assert bbox["z"] <= 256.0


def test_a_width_bound_fit_gives_up_height(fits):
    """Honest accounting: bbox mode does not deliver the requested height, and
    the caller has to be able to see that it did not."""
    assert fits["wide_bbox"]["bbox"]["z"] < 150.0
    assert fits["wide_bbox"]["bbox"]["z"] == pytest.approx(148.16, abs=0.05)
