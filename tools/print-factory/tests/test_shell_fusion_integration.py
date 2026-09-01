"""The whole thing: real GLB + real fixture + real Blender -> a real product.

Size M, the 89mm standard 3.5" reference jar, fused with the wraith shell at
target_height_mm 200. One Blender run for the module; every assertion reads the
metrics.json that prep.py actually wrote.

Marked slow because it remeshes 39,434 triangles to 660,824 and then runs four
EXACT booleans against them. It takes a few seconds, not a few minutes, and it
runs - a fusion pipeline that is only ever exercised by mocks is a pipeline
that has never been tested.
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

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREP = os.path.join(ROOT, "prep.py")
SHELL = os.path.join(ROOT, "examples", "shell.glb")
if not os.path.exists(SHELL):
    pytest.skip(f"examples/shell.glb not present ({SHELL}); it is a generated "
                "artifact and deliberately not committed",
                allow_module_level=True)

M_SPEC = {
    "fixture": "candle_cradle",
    "params": {"jar_dia": 89},
    "shell_glb": SHELL,
    "target_height_mm": 200,
}
TARGET_H = 200.0
JAR_DIA = 89.0
# height - platform_depth: where a jar dropped into the bore comes to rest.
PLATFORM_FLOOR_Z = 175.0

pytestmark = pytest.mark.slow


@pytest.fixture(scope="module")
def fused():
    work = tempfile.mkdtemp(prefix="printfactory-fusion-")
    try:
        spec_path = os.path.join(work, "spec.json")
        out_dir = os.path.join(work, "out")
        with open(spec_path, "w") as fh:
            json.dump(M_SPEC, fh)
        proc = subprocess.run(
            # --python-exit-code 1 is REQUIRED: without it Blender exits 0 on an
            # uncaught exception and a crashed job looks like a successful one.
            [BLENDER, "--background", "--factory-startup", "--python-exit-code", "1",
             "--python", PREP, "--", "--spec", spec_path, "--out", out_dir],
            capture_output=True, text=True, timeout=900,
        )
        detail = f"\n--- stdout ---\n{proc.stdout}\n--- stderr ---\n{proc.stderr}"
        assert proc.returncode == 0, f"blender exited {proc.returncode}{detail}"
        metrics_path = os.path.join(out_dir, "metrics.json")
        assert os.path.exists(metrics_path), f"no metrics.json written{detail}"
        with open(metrics_path) as fh:
            yield json.load(fh), out_dir
    finally:
        shutil.rmtree(work, ignore_errors=True)


def test_the_fused_product_is_manifold(fused):
    """Four EXACT booleans against a remeshed generative mesh. This is the
    assertion that fails first when any of them misbehaves."""
    metrics, _ = fused
    assert metrics["non_manifold_edges"] == 0
    assert metrics["manifold"] is True


def test_the_run_is_clean(fused):
    metrics, _ = fused
    assert metrics["warnings"] == []
    assert metrics["ok"] is True
    assert metrics["degenerate"] is False


def test_it_fits_the_build_volume(fused):
    metrics, _ = fused
    assert metrics["fits_build_volume"] is True


def test_height_matches_the_shell_target(fused):
    """The shell drives the height, not the fixture default - and a voxel
    remesh is a resampling, so half a voxel of slack is expected."""
    metrics, _ = fused
    assert metrics["bbox_mm"]["z"] == pytest.approx(TARGET_H, abs=0.5)


def test_the_footprint_grew_past_the_bare_cradle(fused):
    """The bare M cradle is 104 x 104. If the fused part is still exactly that,
    the shell was silently dropped by the union."""
    metrics, _ = fused
    assert metrics["bbox_mm"]["x"] > 104.0
    assert metrics["bbox_mm"]["y"] > 104.0


# --- step 8: the bore has to survive the union ------------------------------

def test_the_bore_is_still_open_after_the_union(fused):
    """THE assertion. The union welds a solid figure over the jar recess - the
    raw union probes as blocked at z=194.5 - and everything else about that
    part looks perfect. A jar-diameter column of rays dropped down the axis has
    to reach the platform floor."""
    metrics, _ = fused
    probe = metrics["bore_probe"]
    assert probe["misses"] == 0, "rays fell through: the recess has no floor"
    assert probe["first_hit_z_max"] == pytest.approx(PLATFORM_FLOOR_Z, abs=0.5), (
        f"a {JAR_DIA}mm jar stops at z={probe['first_hit_z_max']}, not the "
        f"platform floor at {PLATFORM_FLOOR_Z}"
    )


def test_the_probe_actually_sampled_the_whole_jar_footprint(fused):
    """A single ray down the centreline would pass a bore blocked everywhere
    except its middle."""
    metrics, _ = fused
    assert metrics["bore_probe"]["samples"] >= 9


def test_the_pipeline_reports_the_jar_fits(fused):
    metrics, _ = fused
    assert metrics["jar_fits"] is True


def test_every_fixture_feature_was_re_cut(fused):
    """Not just the bore: the union fills the weight pocket and the lightening
    cavity too, and a 1.5kg part is not a product."""
    metrics, _ = fused
    assert set(metrics["recut_features"]) == {"bore", "weight_pocket", "cavity"}


# --- the shell really was imported and really was repaired ------------------

def test_the_shell_was_the_real_generative_mesh(fused):
    metrics, _ = fused
    assert metrics["shell"]["glb"] == "shell.glb"
    assert metrics["shell"]["raw_tri_count"] == 39434
    assert metrics["shell"]["raw_non_manifold_edges"] == 15658


def test_the_remesh_repaired_the_shell_before_any_boolean(fused):
    metrics, _ = fused
    assert metrics["shell"]["remeshed_tri_count"] > metrics["shell"]["raw_tri_count"]
    assert metrics["shell"]["voxel_mm"] > 0


def test_the_shell_was_scaled_not_assumed(fused):
    """1 GLB unit is not 1mm. A missing scale ships a 1mm speck."""
    metrics, _ = fused
    assert metrics["shell"]["scale"] == pytest.approx(199.6777, abs=0.01)


# --- print economics --------------------------------------------------------

def test_mass_is_physically_plausible(fused):
    """A 200mm PLA holder with a bored recess and two internal voids is
    hundreds of grams. 5g means the normals inverted; 1500g means the union
    filled the cavities and nobody cut them back out."""
    metrics, _ = fused
    assert 150 < metrics["grams_est"] < 900, metrics


def test_the_union_really_did_fill_the_cavities(fused):
    """Guards the guard: if the union stopped filling the cavities, the re-cut
    step would be untested by this suite and could rot silently."""
    metrics, _ = fused
    assert metrics["union_volume_mm3"] > 4 * metrics["volume_mm3"]


def test_a_non_empty_stl_is_written(fused):
    _, out_dir = fused
    stl = os.path.join(out_dir, "model.stl")
    assert os.path.exists(stl), f"model.stl missing from {out_dir}"
    assert os.path.getsize(stl) > 1000, "model.stl is empty or a stub"


def test_no_boolean_retries_were_needed_at_the_default_voxel(fused):
    """Not a correctness requirement - the retry exists precisely because this
    can change - but a regression here means the default voxel stopped working
    and every job just got 4x slower."""
    metrics, _ = fused
    assert metrics["boolean_retries"] == 0, metrics["failed_attempts"]
