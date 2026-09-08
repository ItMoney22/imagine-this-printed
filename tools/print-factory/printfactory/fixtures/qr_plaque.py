"""QR plaque: a flat slab with the dark QR modules recessed as a pocket.

The pocket is what gets filled with a contrasting insert (second filament, resin
or paint). That contrast IS the product - a single-colour raised QR does not
scan, because a camera thresholds on tone, not on relief.

bpy is imported inside the build helpers only, so this module stays importable
(and unit-testable) on a plain interpreter.
"""
from printfactory.fixtures.base import Fixture, FixtureError, register
from printfactory.metrics import fits_build_volume
from printfactory.qr import MIN_MODULE_MM, qr_matrix

DEFAULT_BASE_THICKNESS_MM = 3.0
DEFAULT_POCKET_DEPTH_MM = 0.8      # two 0.4mm layers: enough to seat an insert

# Each module cube is grown by this much on every side before the cut. Adjacent
# dark modules then genuinely overlap instead of sharing an exact face, and
# diagonal neighbours overlap instead of pinching at a point. Without it the
# cut leaves 111 non-manifold edges on a real 33x33 code. 0.01mm is two orders
# of magnitude below what a 0.4mm nozzle can place, so the printed code is
# unchanged.
MODULE_OVERLAP_MM = 0.01

# The cutter pokes out above the top face so the difference never has to resolve
# coplanar faces.
POCKET_OVERSHOOT_MM = 0.2


def _checked_matrix(matrix) -> list[list[int]]:
    """The matrix may arrive as plain data from outside Blender, so it is
    checked here rather than trusted."""
    if not matrix:
        raise FixtureError("matrix must not be empty")
    n = len(matrix)
    for row in matrix:
        if len(row) != n:
            raise FixtureError(f"matrix must be square, got a row of {len(row)} in {n}")
        if any(v not in (0, 1) for v in row):
            raise FixtureError("matrix cells must all be 0 or 1")
    return [[int(v) for v in row] for row in matrix]


def _mesh_from_boxes(boxes, name):
    """One mesh holding every box. Building the whole cutter as a single mesh
    and cutting once is the difference between a 10 second job and an
    unusable one: a 33x33 code has ~541 dark modules, and 541 separate boolean
    operations do not finish in any reasonable time."""
    import bpy
    import bmesh

    bm = bmesh.new()
    for (x0, y0, z0, x1, y1, z1) in boxes:
        vs = [bm.verts.new(c) for c in [
            (x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
            (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]]
        for f in [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
                  (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]:
            bm.faces.new([vs[i] for i in f])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    return obj


@register("qr_plaque")
class QRPlaque(Fixture):
    def validate(self, params: dict) -> dict:
        payload = params.get("payload")
        if not isinstance(payload, str) or not payload:
            raise FixtureError("payload is required and must be a non-empty string")

        module_mm = float(params.get("module_mm", MIN_MODULE_MM))
        if module_mm < MIN_MODULE_MM:
            raise FixtureError(
                f"module_mm {module_mm} below {MIN_MODULE_MM}: will not scan when printed")

        base_thickness = float(params.get("base_thickness", DEFAULT_BASE_THICKNESS_MM))
        pocket_depth = float(params.get("pocket_depth", DEFAULT_POCKET_DEPTH_MM))
        if pocket_depth <= 0:
            raise FixtureError(
                f"pocket_depth {pocket_depth} must be positive: a flat face has no "
                "contrast to scan")
        if pocket_depth >= base_thickness:
            raise FixtureError(
                f"pocket_depth {pocket_depth} >= base_thickness {base_thickness}: "
                "the pocket would punch through the plaque")

        ecc = str(params.get("ecc", "h")).lower()

        supplied = params.get("matrix")
        if supplied is None:
            # segno runs on the system interpreter only. Inside Blender the
            # caller supplies `matrix` and this branch is never taken.
            matrix = qr_matrix(payload, ecc)
        else:
            matrix = supplied
        matrix = _checked_matrix(matrix)

        size_mm = len(matrix) * module_mm
        if not fits_build_volume({"x": size_mm, "y": size_mm, "z": base_thickness}):
            raise FixtureError(
                f"plaque is {size_mm:.1f}mm square and exceeds the build volume; "
                "shorten the payload or drop module_mm")

        return {
            "payload": payload,
            "module_mm": module_mm,
            "base_thickness": base_thickness,
            "pocket_depth": pocket_depth,
            "ecc": ecc,
            "matrix": matrix,
            "size_mm": size_mm,
        }

    def build(self, params: dict, ctx):
        from printfactory import blender_ops as ops

        matrix = params["matrix"]
        module = params["module_mm"]
        base_t = params["base_thickness"]
        pocket = params["pocket_depth"]
        half = params["size_mm"] / 2.0

        slab = _mesh_from_boxes(
            [(-half, -half, 0.0, half, half, base_t)], "qr_plaque")

        pad = MODULE_OVERLAP_MM
        z0 = base_t - pocket
        z1 = base_t + POCKET_OVERSHOOT_MM
        boxes = []
        for r, row in enumerate(matrix):
            for c, cell in enumerate(row):
                if not cell:
                    continue
                # row 0 is the top of the code, column 0 its left edge, read
                # from +Z looking down. Getting this backwards mirrors the code
                # and most readers refuse a mirrored QR.
                x0 = -half + c * module - pad
                y0 = half - (r + 1) * module - pad
                boxes.append((x0, y0, z0,
                              x0 + module + 2 * pad, y0 + module + 2 * pad, z1))
        cutter = _mesh_from_boxes(boxes, "qr_cutter")

        ops.boolean(slab, cutter, "DIFFERENCE", use_self=True)
        return slab
