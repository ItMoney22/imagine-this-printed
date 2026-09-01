"""candle_cradle - a 3D printed holder that cradles a glass jar candle.

Real product, real constraints. A filled 3.5" jar candle is roughly 1kg of glass
and wax sitting on a platform near the top of the piece, so the failure mode
that matters is not print quality, it is the whole thing tipping over on a
nightstand. Two mitigations are baked into the params:

  * `base_width` is refused if it is narrower than the jar, and the
    height/base ratio is run through metrics.tip_risk() before any geometry
    is generated.
  * `weight_pocket` cuts a downward-opening sand chamber into the base, sealed
    off from the rest of the interior by a wall_mm divider so the ballast stays
    at the bottom where it does some good.

Vertical stack, bottom to top (weight_pocket on):

    height ---------------------------  top rim
              bore (open recess)          <- jar sits here, platform_depth deep
    height-platform_depth --------------  platform floor (wall_mm)
              main cavity                 <- lightening void, sealed
    weight_pocket_depth+wall_mm --------  divider floor (wall_mm)
              weight pocket               <- opens downward, sand goes here
    0 ---------------------------------  flat bottom (an annulus)
"""
from printfactory.fixtures.base import Fixture, FixtureError, register
from printfactory.metrics import fits_build_volume, tip_risk
from printfactory.spec import MIN_WALL_MM

# Outside this range it is not a candle jar. 50mm is a votive, 150mm is bigger
# than any retail 3-wick; both ends mean the caller has the wrong product.
MIN_JAR_DIA = 50.0
MAX_JAR_DIA = 150.0

# How much wider than the jar the default base is. Pure tipping margin.
DEFAULT_BASE_MARGIN = 15.0

DEFAULT_HEIGHT = 200.0
DEFAULT_CLEARANCE = 1.2       # radial, so the jar drops in without forcing
DEFAULT_PLATFORM_DEPTH = 25.0
DEFAULT_WALL_MM = 2.4
DEFAULT_POCKET_DEPTH = 15.0

# Boolean cutters overshoot the surface they break through by this much.
# Coplanar faces are exactly where the EXACT solver produces zero-area garbage.
_OVERSHOOT_MM = 1.0

# Segments per generated circle. 32 (Blender's default) leaves visible facets on
# a 100mm barrel and shrinks the true volume by ~0.6%; 128 is under a degree of
# error and still lands ~2k triangles, far below the 40k face limit.
_CIRCLE_SEGMENTS = 128


@register("candle_cradle")
class CandleCradle(Fixture):

    def validate(self, params: dict) -> dict:
        """Pure Python. Returns the fully-resolved dict build() consumes, so
        build() never does arithmetic and never re-derives a default."""
        if params.get("jar_dia") is None:
            raise FixtureError("jar_dia is required")
        jar_dia = float(params["jar_dia"])
        if not (MIN_JAR_DIA <= jar_dia <= MAX_JAR_DIA):
            raise FixtureError(
                f"jar_dia {jar_dia} outside {MIN_JAR_DIA}-{MAX_JAR_DIA}mm; "
                "that is not a candle jar"
            )

        clearance = float(params.get("clearance", DEFAULT_CLEARANCE))
        if clearance <= 0:
            raise FixtureError(
                f"clearance must be positive, got {clearance}; a zero-clearance "
                "bore is an interference fit, not a cradle"
            )
        bore_dia = jar_dia + 2 * clearance

        wall_mm = float(params.get("wall_mm", DEFAULT_WALL_MM))
        if wall_mm < MIN_WALL_MM:
            raise FixtureError(
                f"wall_mm {wall_mm} below printable minimum {MIN_WALL_MM}"
            )

        height = float(params.get("height", DEFAULT_HEIGHT))
        base_width = float(params.get("base_width", jar_dia + DEFAULT_BASE_MARGIN))

        if base_width < jar_dia:
            raise FixtureError(
                f"base_width {base_width} is narrower than the jar ({jar_dia}); "
                "a loaded jar overhanging its own base will tip"
            )
        if base_width < bore_dia + 2 * wall_mm:
            raise FixtureError(
                f"base_width {base_width} leaves no wall around a {bore_dia}mm "
                f"bore at wall_mm {wall_mm}; need at least "
                f"{bore_dia + 2 * wall_mm}"
            )
        if tip_risk(height, base_width):
            raise FixtureError(
                f"tip risk: height {height} on a {base_width} base exceeds the "
                "safe height-to-base ratio for a ~1kg jar"
            )

        bbox = {"x": base_width, "y": base_width, "z": height}
        if not fits_build_volume(bbox):
            raise FixtureError(
                f"{bbox} exceeds the A1 build volume"
            )

        platform_depth = float(params.get("platform_depth", DEFAULT_PLATFORM_DEPTH))
        if platform_depth >= height:
            raise FixtureError(
                f"platform_depth {platform_depth} >= height {height}; the bore "
                "would punch straight through the bottom"
            )

        weight_pocket = bool(params.get("weight_pocket", True))
        pocket_depth = float(params.get("weight_pocket_depth", DEFAULT_POCKET_DEPTH))
        if weight_pocket and pocket_depth >= height - platform_depth:
            raise FixtureError(
                f"weight_pocket_depth {pocket_depth} would meet the bore floor "
                f"at {height - platform_depth}"
            )

        return {
            "jar_dia": jar_dia,
            "clearance": clearance,
            "bore_dia": bore_dia,
            "height": height,
            "platform_depth": platform_depth,
            "base_width": base_width,
            "wall_mm": wall_mm,
            "weight_pocket": weight_pocket,
            "weight_pocket_depth": pocket_depth,
        }

    def build(self, params: dict, ctx):
        """Blender only. Straight barrel, three subtractive cuts.

        Deliberately NOT voxel_remesh()'d: that helper exists to repair generated
        or imported meshes that self-intersect, and remeshing a 104x104x200 part
        at 0.6mm would both explode the triangle count and round off the flat
        bottom this thing has to stand on. Primitives are already watertight.

        Deliberately NOT hollow()'d either. Solidify follows the outer surface,
        so on a bored barrel it produces ONE continuous void from the bottom skin
        to the underside of the platform - there is nowhere to trap ballast - and
        its even-offset pinches into non-manifold garbage as soon as the annulus
        between bore and outer wall drops near 2*wall_mm. The cavities here are
        booleans so their extents are exact and independently checkable.
        """
        import bpy
        from printfactory import blender_ops as ops

        base_width = params["base_width"]
        height = params["height"]
        wall = params["wall_mm"]
        platform_depth = params["platform_depth"]

        body = _cylinder(bpy, dia=base_width, z0=0.0, z1=height, name="cradle")

        # 1. the bore: the recess the jar actually sits in, cut into the top face.
        bore = _cylinder(bpy, dia=params["bore_dia"],
                         z0=height - platform_depth, z1=height + _OVERSHOOT_MM,
                         name="bore_cut")
        ops.boolean(body, bore, "DIFFERENCE")

        cavity_dia = base_width - 2 * wall
        cavity_floor = wall

        # 2. the sand chamber, opening downward through the bottom face.
        if params["weight_pocket"]:
            pocket_top = params["weight_pocket_depth"]
            pocket = _cylinder(bpy, dia=cavity_dia,
                               z0=-_OVERSHOOT_MM, z1=pocket_top,
                               name="pocket_cut")
            ops.boolean(body, pocket, "DIFFERENCE")
            cavity_floor = pocket_top + wall

        # 3. the lightening cavity between the divider and the platform floor.
        #    Sealed on purpose - it is what turns a 2kg billet into a ~270g part.
        cavity_ceiling = height - platform_depth - wall
        if cavity_ceiling - cavity_floor > 0:
            cavity = _cylinder(bpy, dia=cavity_dia,
                               z0=cavity_floor, z1=cavity_ceiling,
                               name="cavity_cut")
            ops.boolean(body, cavity, "DIFFERENCE")

        return body


def _cylinder(bpy, dia: float, z0: float, z1: float, name: str):
    """Z-axis cylinder spanning exactly z0..z1, centred on XY."""
    depth = z1 - z0
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=_CIRCLE_SEGMENTS,
        radius=dia / 2.0,
        depth=depth,
        location=(0.0, 0.0, z0 + depth / 2.0),
    )
    obj = bpy.context.active_object
    obj.name = name
    return obj
