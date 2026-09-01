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
