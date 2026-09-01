"""Print economics. Pure arithmetic - no Blender import, so it stays testable."""

PLA_DENSITY = 1.24   # g/cm3
PETG_DENSITY = 1.27  # g/cm3

def grams_for_volume(volume_mm3: float, density: float = PLA_DENSITY) -> float:
    """Filament mass for a solid volume.

    A hollowed shell's `volume_mm3` is the shell material itself, so this is the
    real number - not an infill guess. Slicer output supersedes it in Phase 3.
    """
    if volume_mm3 < 0:
        raise ValueError(f"negative volume {volume_mm3}: mesh normals are inverted")
    return (volume_mm3 / 1000.0) * density

A1_BUILD_MM = {"x": 256, "y": 256, "z": 256}       # Bambu A1
A1_MINI_BUILD_MM = {"x": 180, "y": 180, "z": 180}  # A1 mini

# Height-to-base ratio above which a top-heavy piece tips. A candle holder
# carries ~1kg of glass and wax at full height, so this is deliberately strict.
MAX_HEIGHT_TO_BASE = 2.5

def fits_build_volume(bbox_mm: dict, build: dict = None) -> bool:
    b = build or A1_BUILD_MM
    return all(bbox_mm[axis] <= b[axis] for axis in ("x", "y", "z"))

def tip_risk(height_mm: float, base_width_mm: float) -> bool:
    """True when the piece is too tall for its footprint to stay upright loaded."""
    if base_width_mm <= 0:
        raise ValueError("base_width_mm must be positive")
    return (height_mm / base_width_mm) > MAX_HEIGHT_TO_BASE


# Below this a "solid" is a rounding artefact, not a part: 1 mm3 is a cube a
# millimetre on a side, four times under a single 0.4mm extrusion.
MIN_PRINTABLE_VOLUME_MM3 = 1.0


def degenerate_reasons(stats: dict, bbox_mm: dict) -> list:
    """Reasons the mesh is not a part at all. Empty list means it is real.

    This exists because of one specific way a boolean run fails silently: the
    solver consumes the whole model. What is left has zero edges, so
    `non_manifold_edges == 0`, so `manifold` reports True, `warnings` comes back
    empty and `ok` comes back True - a job that produced nothing looks like the
    cleanest run of the day, and an STL with no triangles goes to the printer.
    """
    reasons = []
    if stats.get("tri_count", 0) <= 0:
        reasons.append(
            f"tri_count {stats.get('tri_count', 0)}: the mesh has no faces"
        )
    volume = stats.get("volume_mm3", 0.0)
    if volume < MIN_PRINTABLE_VOLUME_MM3:
        reasons.append(
            f"volume {volume}mm3 below {MIN_PRINTABLE_VOLUME_MM3}mm3: nothing solid left"
        )
    for axis in ("x", "y", "z"):
        if bbox_mm.get(axis, 0.0) <= 0.0:
            reasons.append(f"bbox {axis} is {bbox_mm.get(axis, 0.0)}: collapsed axis")
    return reasons
