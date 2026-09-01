"""Fuse a generative shell onto a parametric fixture, or refuse to.

Runs inside Blender but never imports bpy itself - everything Blender-shaped
goes through blender_ops, so the ordering decisions in here stay readable and
the bpy surface stays in one file.

The order is not arbitrary:

  import -> normalise -> REMESH -> build fixture -> union -> flatten base
         -> RE-CUT THE FIXTURE'S FEATURES -> hollow (if it survives)
         -> decimate -> PROBE THE BORE

Three of those steps are load-bearing in a way that is easy to get wrong, and
all three were caught by measurement on the real wraith shell, not by theory.

REMESH BEFORE ANY BOOLEAN. examples/shell.glb carries 15,658 non-manifold
edges on 39,434 triangles. That is not a bad file, it is what generative 3D
produces. A 0.6mm voxel remesh takes it to 660,824 triangles and zero
non-manifold edges, and only then will the EXACT solver behave.

RE-CUT AFTER THE UNION. The union welds a solid figure onto a cradle whose
whole purpose is the void inside it, and the figure fills every void it has.
Measured: the M cradle went from 219,410mm3 to 1,216,629mm3 - a 1.5kg part -
with the jar bore blocked at z=194.5 by the figure's own head. A part that
skips this step is manifold, is the right height, and cannot hold a candle.

PROBE LAST. The bore is verified by ray-casting the finished geometry, after
the hollow and the decimate, because either of those can close it again.
"""
import os

from printfactory import blender_ops as ops
from printfactory.metrics import degenerate_reasons
from printfactory.shellprep import (bore_blockage, bore_cut_span,
                                    retry_voxel_sizes)


class FusionError(RuntimeError):
    """The shell and the fixture could not be fused into a printable solid."""


# Below this share of the finished part, the decorative shell is not visibly
# part of the product and the job says so out loud. Not an error - the part is
# still a correct, printable holder - but it is the difference between selling
# a sculpted piece and selling a cylinder.
SHELL_VISIBLE_PCT = 5.0


def _require_solid(stage: str, obj, min_volume_mm3=None):
    """Every boolean is followed by this.

    The degenerate check catches a boolean that left literally nothing.
    `min_volume_mm3` catches the far nastier case: a boolean that left a
    watertight, manifold, correctly-oriented crumb. Measured on this pipeline,
    a bad base cut turned 1,216,629mm3 into 12mm3, and every check that did not
    know how big the part was SUPPOSED to be waved it straight through. An
    absolute floor cannot catch that. A relative one can.
    """
    stats = ops.mesh_stats(obj)
    bbox = ops.bbox_mm(obj)
    reasons = degenerate_reasons(stats, bbox)
    if reasons:
        raise FusionError(f"{stage}: model is degenerate - {'; '.join(reasons)}")
    if stats["non_manifold_edges"] > 0:
        raise FusionError(
            f"{stage}: {stats['non_manifold_edges']} non-manifold edges; "
            "an EXACT boolean on this would compound the damage"
        )
    if min_volume_mm3 is not None and stats["volume_mm3"] < min_volume_mm3:
        raise FusionError(
            f"{stage}: volume collapsed to {stats['volume_mm3']:.0f}mm3, under "
            f"the {min_volume_mm3:.0f}mm3 this step had to leave standing - the "
            "solver ate the part and handed back a watertight crumb"
        )
    return stats, bbox


def fuse(spec, fixture, params):
    """Build the fused product. Returns (obj, extras) or raises FusionError.

    On a boolean failure the whole attempt is thrown away and retried at half
    the voxel size - a finer remesh gives the solver cleaner topology. The
    shell is re-imported per attempt because the remesh is destructive, and a
    half-remeshed shell would poison the retry.
    """
    if not spec.shell_glb:
        raise FusionError("fuse() called without spec.shell_glb")
    target_h = spec.target_height_mm or params.get("height")
    if not target_h:
        raise FusionError(
            "shell job needs target_height_mm (or a fixture height to borrow)"
        )

    failures = []
    for attempt, voxel in enumerate(retry_voxel_sizes(spec.voxel_mm)):
        try:
            obj, extras = _attempt(spec, fixture, params, target_h, voxel)
        except Exception as exc:                       # noqa: BLE001
            failures.append(f"voxel {voxel}mm: {type(exc).__name__}: {exc}")
            print(f"BOOLEAN-FAILURE attempt {attempt} at voxel {voxel}mm: {exc}")
            continue
        extras["boolean_retries"] = attempt
        extras["failed_attempts"] = failures
        return obj, extras

    # Never fall through to an export. A bad STL is worse than no STL: it looks
    # like a delivered job right up until it is on a plate.
    raise FusionError(
        "shell/fixture fusion failed at every voxel size, no STL written:\n  "
        + "\n  ".join(failures)
    )


def _attempt(spec, fixture, params, target_h, voxel_mm):
    ops.clear_scene()

    shell = ops.import_glb(spec.shell_glb)
    raw = ops.mesh_stats(shell)
    plan = ops.normalise_shell(shell, target_h)

    # Mandatory. Not a quality knob.
    ops.voxel_remesh(shell, voxel_mm)
    remeshed, _ = _require_solid("shell remesh", shell)

    # The UNCUT body - see CandleCradle.build_body() for why the finished
    # cradle is the wrong thing to union against.
    cradle = fixture.build_body(params, ctx=spec)
    body_stats, body_bbox = _require_solid("fixture body", cradle)

    # A union can only ADD material, so anything at or below the bare body's
    # own volume means the solver dropped one of its two inputs on the floor.
    ops.boolean(cradle, shell, "UNION")
    union_stats, union_bbox = _require_solid(
        "shell union", cradle, min_volume_mm3=body_stats["volume_mm3"])
    for axis in ("x", "y", "z"):
        if union_bbox[axis] < body_bbox[axis] - 0.01:
            raise FusionError(
                f"shell union: bbox {axis} shrank {body_bbox[axis]:.2f} -> "
                f"{union_bbox[axis]:.2f}mm; a union cannot lose material, so "
                "the solver dropped an input"
            )

    flattened = ops.flatten_base(cradle, 0.0)
    if flattened:
        _require_solid("base flatten", cradle,
                       min_volume_mm3=0.9 * union_stats["volume_mm3"])

    recut = _recut_fixture_features(fixture, params, cradle)
    # The features hollow most of the barrel out - the M cradle keeps ~13% of
    # its solid volume - so this floor is deliberately low. It is here to catch
    # annihilation, not to second-guess the fixture's own geometry.
    after_recut, _ = _require_solid(
        "feature re-cut", cradle, min_volume_mm3=0.05 * body_stats["volume_mm3"])

    hollow_note = _hollow_if_viable(cradle, spec.wall_mm)

    pre_decimate = ops.mesh_stats(cradle)["volume_mm3"]
    ops.decimate_to(cradle, spec.face_limit)
    _require_solid("decimate", cradle, min_volume_mm3=0.8 * pre_decimate)

    # LAST, on exactly the geometry that gets exported - a hollow or a decimate
    # can close the bore just as effectively as the union can.
    probe = ops.probe_column(cradle, params["jar_dia"],
                             z_from=ops.bbox_mm(cradle)["z"] + 10.0)
    _require_open_bore(probe, bore_floor_z=recut["bore_floor_z"],
                       jar_dia=params["jar_dia"])

    # How much of the shell is actually ON the outside of the product. A
    # generative figure narrower than the fixture it is fused to disappears
    # inside it, and every other number in this report stays healthy while it
    # happens: manifold, right height, right mass, jar fits. This is the only
    # field that says whether the customer can see what they paid for.
    final_stats = ops.mesh_stats(cradle)
    proud_mm3 = union_stats["volume_mm3"] - body_stats["volume_mm3"]
    proud_pct = 100.0 * proud_mm3 / final_stats["volume_mm3"]
    notes = []
    if proud_pct < SHELL_VISIBLE_PCT:
        notes.append(
            f"shell adds only {proud_mm3:.0f}mm3 ({proud_pct:.2f}% of the part) "
            f"outside the fixture body: it is almost entirely swallowed by the "
            f"{body_bbox['x']:.0f}mm-wide body, so the product reads as the bare "
            "fixture with a decorative flare, not as the generated figure"
        )

    return cradle, {
        "shell": {
            "glb": os.path.basename(spec.shell_glb),
            "raw_tri_count": raw["tri_count"],
            "raw_non_manifold_edges": raw["non_manifold_edges"],
            "scale": round(plan["scale"], 4),
            "target_height_mm": target_h,
            "voxel_mm": voxel_mm,
            "remeshed_tri_count": remeshed["tri_count"],
            "remeshed_volume_mm3": round(remeshed["volume_mm3"], 1),
            "proud_of_body_mm3": round(proud_mm3, 1),
            "proud_of_body_pct": round(proud_pct, 3),
        },
        "union_tri_count": union_stats["tri_count"],
        "union_bbox_mm": {k: round(v, 2) for k, v in union_bbox.items()},
        "union_volume_mm3": round(union_stats["volume_mm3"], 1),
        "base_flattened": flattened,
        "recut_features": recut["names"],
        "recut_volume_mm3": round(after_recut["volume_mm3"], 1),
        "hollow": hollow_note,
        "bore_probe": probe,
        "jar_fits": True,
        "notes": notes,
    }


def _recut_fixture_features(fixture, params, obj):
    """Re-cut every subtractive feature the union just filled in.

    Step 8 is usually described as "re-cut the bore", and the bore is the one
    that makes the product worthless if it is missed - the jar stops dead on
    the shell's head. But a union with a solid shell fills ALL of them, and the
    other two matter too: measured on the real wraith, the union took the M
    cradle from 219,410mm3 to 1,216,629mm3 because the figure's body flooded
    the lightening cavity AND the weight pocket. A filled sand chamber is not a
    cosmetic defect, it is a ballast feature you can no longer put ballast in.

    The extents come from the fixture's own cut_plan(), never re-derived here -
    two definitions of the same cavity drift apart on the first edit.
    """
    if not hasattr(fixture, "cut_plan"):
        raise FusionError(
            f"{type(fixture).__name__} has no cut_plan(); a shell cannot be "
            "safely unioned onto a fixture that cannot say what it hollowed out"
        )
    model_top = ops.bbox_mm(obj)["z"]
    names, bore_floor_z = [], None
    for cut in fixture.cut_plan(params):
        z0, z1 = cut["z0"], cut["z1"]
        if cut.get("open_top"):
            # Must clear the top of the MODEL, which after a union can sit
            # above the top of the cradle.
            z0, z1 = bore_cut_span(params["height"], params["platform_depth"],
                                   model_top)
            bore_floor_z = z0
        tool = ops.cylinder(cut["dia"], z0, z1, f"{cut['name']}_recut")
        ops.boolean(obj, tool, "DIFFERENCE")
        names.append(cut["name"])
    if bore_floor_z is None:
        raise FusionError("fixture cut_plan has no open_top cut; there is "
                          "nothing to verify the jar against")
    return {"names": names, "bore_floor_z": bore_floor_z}


def _require_open_bore(probe, bore_floor_z, jar_dia):
    """The step-8 gate. Everything else can be right and this still wrong.

    The reading itself lives in shellprep.bore_blockage() so it is unit-tested
    without Blender; this only decides what to do about it.
    """
    reason = bore_blockage(probe, bore_floor_z, jar_dia)
    if reason:
        raise FusionError(
            f"bore is blocked: {reason}. This product cannot hold the thing it "
            "exists to hold."
        )


def _hollow_if_viable(obj, wall_mm):
    """Try to hollow; keep it only if the result is still a printable solid.

    Solidify follows the outer surface, and on a bored barrel the fixture's own
    docstring records that it pinches into non-manifold garbage where the
    annulus narrows. On a shell-fused part there is far more surface to pinch,
    so this is attempted against a snapshot and rolled back on any damage.
    """
    before = ops.mesh_stats(obj)
    before_bbox = ops.bbox_mm(obj)
    snap = ops.snapshot(obj)
    try:
        ops.hollow(obj, wall_mm)
    except Exception as exc:                            # noqa: BLE001
        ops.restore(obj, snap)
        return f"skipped: solidify raised {type(exc).__name__}: {exc}"

    stats = ops.mesh_stats(obj)
    bbox = ops.bbox_mm(obj)
    bad = degenerate_reasons(stats, bbox)
    if stats["non_manifold_edges"] > 0:
        bad.append(f"{stats['non_manifold_edges']} non-manifold edges")
    # Solidify's even-offset can invert on a pinched annulus and throw geometry
    # to infinity. Measured on this part: a 104 x 104 x 200mm model came back
    # 150992 x 66948 x 48341mm and was still manifold and still non-degenerate,
    # so the bounding box is the only thing that catches it.
    for axis in ("x", "y", "z"):
        if abs(bbox[axis] - before_bbox[axis]) > 1.0:
            bad.append(
                f"bbox {axis} moved {before_bbox[axis]:.1f} -> {bbox[axis]:.1f}mm"
            )
    if stats["volume_mm3"] >= before["volume_mm3"]:
        bad.append("hollowing did not reduce volume")
    if bad:
        ops.restore(obj, snap)
        return f"reverted: {'; '.join(bad)}"

    ops.discard(snap)
    saved = before["volume_mm3"] - stats["volume_mm3"]
    return f"applied at {wall_mm}mm wall, saved {saved / 1000.0:.1f}cm3"
