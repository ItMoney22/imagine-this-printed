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


def normalise_plan(bbox_min, bbox_max, target_height_mm: float) -> dict:
    """Plan the scale+translate that puts a Z-up mesh into print space.

    Returns {"scale": float, "translate": (dx, dy, dz)}, applied in that order
    (scale about the origin first, translate second) - the same order as the
    Node converter, which matters because the translate is derived from the
    ALREADY SCALED bounds.
    """
    if target_height_mm is None or target_height_mm <= 0:
        raise ShellError(
            f"target_height_mm must be positive, got {target_height_mm!r}"
        )
    if target_height_mm > A1_BUILD_MM["z"]:
        raise ShellError(
            f"target_height_mm {target_height_mm} exceeds the A1 build volume "
            f"({A1_BUILD_MM['z']}mm); no point remeshing a part the printer refuses"
        )

    height = bbox_max[2] - bbox_min[2]
    if height <= 0:
        raise ShellError(
            "shell has zero height on Z; it is flat or the import produced no "
            "geometry, and nothing can be scaled to fit"
        )

    scale = target_height_mm / height

    # Derived from the scaled bounds, exactly like the Node converter's second
    # computeBoundingBox() pass.
    x0, x1 = bbox_min[0] * scale, bbox_max[0] * scale
    y0, y1 = bbox_min[1] * scale, bbox_max[1] * scale
    z0 = bbox_min[2] * scale

    return {
        "scale": float(scale),
        "translate": (-(x0 + x1) / 2.0, -(y0 + y1) / 2.0, -z0),
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
