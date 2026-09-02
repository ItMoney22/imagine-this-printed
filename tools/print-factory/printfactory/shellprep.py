"""Transform maths for fusing a generative shell (GLB) onto a fixture.

Pure Python on purpose - no `import bpy` - so the arithmetic that decides where
a 2.3MB generated mesh lands in print space is unit-testable on any machine.
Blender only ever executes the plan this module hands it.

ORIENTATION, and why there is no rotation in the plan
-----------------------------------------------------
`backend/services/glb-to-stl.ts` (the Node converter that already ships) does
three things to an imported GLB, in this order:

    1. Y-up -> Z-up            new THREE.Matrix4().makeRotationX(-Math.PI/2)
    2. uniform scale           factor = targetHeightMm / bboxSize.z
    3. centre XY, ground Z     translate(-center.x, -center.y, -bbox.min.z)

Blender's glTF importer performs step 1 itself. Verified against the real
examples/shell.glb rather than assumed: the raw POSITION accessor in the file
reads min [-0.27463, -0.50101, -0.28674] / max [0.27410, 0.50060, 0.27885], so
the 1.0016-unit height sits on glTF +Y; after `bpy.ops.import_scene.gltf` the
same mesh measures 0.5487 x 0.5656 x 1.0016 in Blender with the height on +Z
and the third axis negated - which is precisely makeRotationX(-pi/2),
(x, y, z) -> (x, -z, y). Applying our own rotation on top would lay the model on
its side. So this module plans steps 2 and 3 only, and the two pipelines land
byte-comparably.
"""
from printfactory.metrics import A1_BUILD_MM


class ShellError(ValueError):
    """A shell that cannot be normalised into printable space."""


# How a shell is sized into print space.
#   "height" - scale so Z equals target_height_mm. What the Node converter does,
#              and the right answer for a figure taller than it is wide.
#   "bbox"   - scale so the WHOLE shell fits the build volume, taking whichever
#              of height/x/y/z binds first.
FIT_MODES = ("height", "bbox")

# Clearance held back from each build axis in bbox mode. A 0.6mm voxel remesh
# can push a surface out by half a voxel after the fit is computed, and a part
# sized to exactly 256.00mm leaves the slicer no room for a skirt.
BUILD_MARGIN_MM = 2.0


def normalise_plan(bbox_min, bbox_max, target_height_mm: float,
                   fit: str = "height", build: dict = None,
                   margin_mm: float = BUILD_MARGIN_MM) -> dict:
    """Plan the scale+translate that puts a Z-up mesh into print space.

    Returns {"scale", "translate", "bound_by", "fitted_bbox_mm"}. Scale is
    applied about the origin first, translate second - the same order as the
    Node converter, which matters because the translate is derived from the
    ALREADY SCALED bounds.

    `fit` decides what "fits" means, and the distinction is not academic.
    target_height_mm silently assumes HEIGHT is the binding dimension. For a
    squat, wide figure it is not: examples/shell2.glb is 1.714x wider than it
    is tall, so scaling it to a perfectly legal 150mm height yields a 257mm
    width that the A1 cannot print - and nothing notices until
    fits_build_volume fails, after the remesh and every boolean have been paid
    for. fit="bbox" takes the tightest of all four constraints up front.
    """
    if fit not in FIT_MODES:
        raise ShellError(f"unknown fit mode {fit!r}; expected one of {FIT_MODES}")
    if target_height_mm is None or target_height_mm <= 0:
        raise ShellError(
            f"target_height_mm must be positive, got {target_height_mm!r}"
        )

    size = tuple(bbox_max[i] - bbox_min[i] for i in range(3))
    if size[2] <= 0:
        raise ShellError(
            "shell has zero height on Z; it is flat or the import produced no "
            "geometry, and nothing can be scaled to fit"
        )

    # (scale, what bound it). The smallest wins.
    candidates = [(target_height_mm / size[2], "height")]

    if fit == "bbox":
        b = build or A1_BUILD_MM
        for i, axis in enumerate("xyz"):
            allowed = b[axis] - margin_mm
            if allowed <= 0:
                raise ShellError(
                    f"margin {margin_mm}mm leaves no room on {axis} of a "
                    f"{b[axis]}mm build volume"
                )
            if size[i] > 0:
                candidates.append((allowed / size[i], axis))
    elif target_height_mm > A1_BUILD_MM["z"]:
        # In height mode nothing else will clamp this, so refuse it here rather
        # than remesh 40,000 triangles for a part the printer will not take.
        raise ShellError(
            f"target_height_mm {target_height_mm} exceeds the A1 build volume "
            f"({A1_BUILD_MM['z']}mm); no point remeshing a part the printer refuses"
        )

    scale, bound_by = min(candidates, key=lambda c: c[0])

    # Derived from the scaled bounds, exactly like the Node converter's second
    # computeBoundingBox() pass.
    x0, x1 = bbox_min[0] * scale, bbox_max[0] * scale
    y0, y1 = bbox_min[1] * scale, bbox_max[1] * scale
    z0 = bbox_min[2] * scale

    return {
        "scale": float(scale),
        "translate": (-(x0 + x1) / 2.0, -(y0 + y1) / 2.0, -z0),
        "fit": fit,
        "bound_by": bound_by,
        "fitted_bbox_mm": {axis: size[i] * scale
                           for i, axis in enumerate("xyz")},
    }


def apply_plan(point, plan: dict) -> tuple:
    """Scale then translate a single point. The plan's own definition, so the
    tests check the contract rather than a reimplementation of it."""
    s = plan["scale"]
    t = plan["translate"]
    return tuple(point[i] * s + t[i] for i in range(3))


def bore_cut_span(cradle_height: float, platform_depth: float,
                  model_top_z: float, overshoot: float = 1.0) -> tuple:
    """Z extent of the bore cutter that has to be re-applied after the union.

    The fixture's own bore is open to the top of the CRADLE. Once a shell is
    unioned on, the top of the MODEL can be higher, and any shell geometry
    sitting in that column caps the jar in - the product is then a decoration
    with a hole in it, not a candle holder. So the re-cut always runs from the
    platform floor to above whichever is taller, plus an overshoot so the
    cutter never ends coplanar with a surface (coplanar faces are where the
    EXACT solver emits zero-area garbage).
    """
    if platform_depth >= cradle_height:
        raise ShellError(
            f"platform_depth {platform_depth} >= cradle height {cradle_height}; "
            "the bore would punch through the base"
        )
    z0 = cradle_height - platform_depth
    z1 = max(model_top_z, cradle_height) + overshoot
    return (z0, z1)


def retry_voxel_sizes(voxel_mm: float, retries: int = 1) -> list:
    """Voxel sizes to try, in order, when a boolean fails.

    A finer remesh hands the EXACT solver cleaner topology, but at ~8x the
    triangles per halving - so it is strictly a retry, never the first choice.
    """
    if voxel_mm is None or voxel_mm <= 0:
        raise ShellError(f"voxel_mm must be positive, got {voxel_mm!r}")
    if retries < 0:
        raise ShellError(f"retries must be >= 0, got {retries}")
    sizes = [float(voxel_mm)]
    for _ in range(retries):
        sizes.append(sizes[-1] / 2.0)
    return sizes


# How far above the platform floor an obstruction may sit before the jar is
# considered blocked. Half a millimetre: less than two printed layers, which is
# about the fuzz a voxel remesh leaves on a nominally flat floor.
BORE_CLEARANCE_TOL_MM = 0.5


def bore_blockage(probe: dict, bore_floor_z: float, jar_dia: float,
                  tol: float = BORE_CLEARANCE_TOL_MM):
    """Read a downward ray probe of the jar column. None means the jar fits.

    Pure so the gate that decides whether a product is worth printing can be
    tested without launching Blender. `probe` is whatever blender_ops
    .probe_column() returned.

    Two distinct failures, and the second is easy to miss: an obstruction ABOVE
    the platform floor means the jar stops early (the fused shell's own head
    sitting in the recess); a ray that hits NOTHING means there is no floor
    under the jar at all, which reads as "wonderfully clear" to any check that
    only looks at how deep the hits went.
    """
    if probe.get("misses"):
        return (f"{probe['misses']}/{probe['samples']} probe rays passed clean "
                "through the model - the jar recess has no floor to stand on")
    top = probe.get("first_hit_z_max")
    if top is None:
        return "the probe recorded no hits at all; there is nothing to sit on"
    if top > bore_floor_z + tol:
        return (f"a {jar_dia}mm jar stops at z={top:.2f} but the platform floor "
                f"is at z={bore_floor_z:.2f} - {top - bore_floor_z:.2f}mm of "
                "obstruction fills the recess this product exists to provide")
    return None


# Slack allowed between a union's bounding box and the componentwise union of
# its inputs'. Both ends of this are measured, not guessed:
#
#   real noise   fusing shell.glb at 200mm, the union came back 0.702mm short
#                on +y only (56.428 -> 55.726) while -y held exactly. Not a
#                dropped island - the mesh is one connected component before
#                and after - but a thin robe-edge sliver the solver collapsed.
#                0.62% of that axis.
#   real failure fusing shell2.glb at 120mm, the union came back 104.00mm wide
#                against inputs spanning 205.73mm. 49.4% of that axis.
#
# Two orders of magnitude apart, so the test is proportional. This guard exists
# to catch a DROPPED INPUT, which is categorical; shaved slivers are the volume
# floor's and proud_of_body_pct's business, not this one's.
UNION_BBOX_TOL_MM = 0.5
UNION_BBOX_TOL_FRAC = 0.05


def union_bbox_shortfall(union_bbox: dict, *input_bboxes: dict,
                         tol: float = UNION_BBOX_TOL_MM,
                         tol_frac: float = UNION_BBOX_TOL_FRAC):
    """None if the union covers all its inputs. Otherwise say which axis lost.

    The invariant is exact: a union of solids spans the componentwise union of
    their bounding boxes, because a union cannot remove material. Anything
    less means the solver silently discarded an input.

    This is the one check that catches a dropped input. Manifoldness cannot -
    the survivor is a perfectly good solid. Nor can volume: the survivor here
    was the fixture body, so the result was BIGGER than the bare-body floor
    the volume gate was comparing against, and sailed through.
    """
    for axis in ("x", "y", "z"):
        expected = max(b[axis] for b in input_bboxes)
        got = union_bbox[axis]
        if got < expected - max(tol, tol_frac * expected):
            return (f"union {axis} is {got:.2f}mm but its inputs already span "
                    f"{expected:.2f}mm; a union cannot lose material, so the "
                    "solver dropped an input")
    return None


# Slack on the fusion volume identity. Measured: +0.09% and -0.04% on the two
# correct runs, +226% on the one where a cut silently did nothing.
FUSION_VOLUME_TOL_FRAC = 0.02
FUSION_VOLUME_TOL_MM3 = 500.0


def fusion_volume_mismatch(final_mm3: float, bare_fixture_mm3: float,
                           proud_mm3: float,
                           tol_frac: float = FUSION_VOLUME_TOL_FRAC,
                           tol_mm3: float = FUSION_VOLUME_TOL_MM3):
    """None if the fused part weighs what the geometry says it must.

    Every subtractive feature a fixture cuts lies strictly inside its own body,
    and shell material outside that body is never touched by those cuts. So:

        final == (body - cuts) + (shell outside body) == bare_fixture + proud

    which makes this an exact accounting identity, not a heuristic. It is the
    only check that catches a DIFFERENCE that silently removed nothing: the
    result is still watertight, still the right size, still passes a bore
    probe, and simply contains a cavity's worth of material it should not.
    """
    expected = bare_fixture_mm3 + proud_mm3
    slack = max(tol_mm3, tol_frac * expected)
    if abs(final_mm3 - expected) > slack:
        direction = "more" if final_mm3 > expected else "less"
        return (f"fused part is {final_mm3:.0f}mm3 but the geometry demands "
                f"{expected:.0f}mm3 (bare fixture {bare_fixture_mm3:.0f} + "
                f"{proud_mm3:.0f} proud of it): {abs(final_mm3-expected):.0f}mm3 "
                f"{direction} than exists, so a cut did not take")
    return None
