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


# Anything below this is a destroyed mesh, not a part. One cubic millimetre is
# far under any real product and far over floating-point noise.
MIN_VIABLE_VOLUME_MM3 = 1.0


def degenerate_reasons(stats: dict, bbox: dict) -> list[str]:
    """Blocking reasons a mesh is not a real solid. Empty list means it is.

    Measured on Blender 5.2.1: a boolean whose tool fully consumes its target
    leaves an object with zero geometry, and EVERY other gate waves it through.
    non_manifold_edges is 0 because there are no edges; a zero bbox "fits" any
    build volume; grams_est is a tidy 0.0. Meanwhile tip_risk() raises
    "base_width_mm must be positive" - a confusing error that says nothing about
    the real cause. Worse, a PARTIALLY destroyed mesh keeps a non-zero bbox and
    reports ok=true with no warnings at all.

    So emptiness has to be checked explicitly, and checked BEFORE tip_risk.
    """
    reasons = []
    if stats["tri_count"] <= 0:
        reasons.append("mesh has no triangles: the boolean destroyed the model")
    if stats["volume_mm3"] < MIN_VIABLE_VOLUME_MM3:
        reasons.append(
            f"volume {stats['volume_mm3']:.4f}mm3 is below the viable minimum "
            f"{MIN_VIABLE_VOLUME_MM3}mm3")
    if min(bbox["x"], bbox["y"], bbox["z"]) <= 0:
        reasons.append("bounding box has a zero dimension")
    return reasons
