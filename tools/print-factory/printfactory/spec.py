"""The job contract. Every fixture and every consumer speaks this."""
from dataclasses import dataclass, field
from printfactory.metrics import PLA_DENSITY

KNOWN_FIXTURES = {"qr_plaque", "candle_cradle", "wifi_card", "table_stand"}
MIN_WALL_MM = 0.8  # two passes of a 0.4mm nozzle

class SpecError(ValueError):
    pass

@dataclass
class JobSpec:
    fixture: str
    params: dict = field(default_factory=dict)
    shell_glb: str | None = None      # None for pure-parametric products
    target_height_mm: float | None = None
    wall_mm: float = 2.4
    voxel_mm: float = 0.6
    face_limit: int = 40_000
    density: float = PLA_DENSITY

    @classmethod
    def from_dict(cls, d: dict) -> "JobSpec":
        fixture = d.get("fixture")
        if not fixture:
            raise SpecError("fixture is required")
        if fixture not in KNOWN_FIXTURES:
            raise SpecError(f"unknown fixture {fixture!r}")
        wall = float(d.get("wall_mm", 2.4))
        if wall < MIN_WALL_MM:
            raise SpecError(f"wall_mm {wall} below printable minimum {MIN_WALL_MM}")
        return cls(
            fixture=fixture,
            params=d.get("params", {}),
            shell_glb=d.get("shell_glb"),
            target_height_mm=d.get("target_height_mm"),
            wall_mm=wall,
            voxel_mm=float(d.get("voxel_mm", 0.6)),
            face_limit=int(d.get("face_limit", 40_000)),
            density=float(d.get("density", PLA_DENSITY)),
        )
