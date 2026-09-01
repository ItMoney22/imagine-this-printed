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
