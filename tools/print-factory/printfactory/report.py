"""The metrics.json contract, in one place.

Pure - takes numbers already pulled out of Blender, so it stays importable and
testable outside it. Lives here rather than inside prep.py because the batch
runner writes the same document, and two divergent definitions of "grams_est"
or "warnings" is exactly the drift that makes a print queue untrustworthy.
"""
from printfactory.metrics import (grams_for_volume, fits_build_volume, tip_risk,
                                  degenerate_reasons)


def build_metrics(fixture: str, params: dict, stats: dict, bbox: dict,
                  density: float) -> dict:
    warnings = []
    # First, because every other check below is meaningless on a model the
    # booleans ate: zero faces reports as manifold and fits every build volume.
    degenerate = degenerate_reasons(stats, bbox)
    warnings.extend(f"degenerate: {r}" for r in degenerate)
    if stats["non_manifold_edges"] > 0:
        warnings.append(f"{stats['non_manifold_edges']} non-manifold edges")
    if not fits_build_volume(bbox):
        warnings.append("exceeds A1 build volume")
    # tip_risk divides by the footprint, so it is only meaningful once we know
    # there IS a footprint. A collapsed model has already been flagged above.
    footprint = min(bbox["x"], bbox["y"])
    if footprint > 0 and tip_risk(bbox["z"], footprint):
        warnings.append("tip risk: base too narrow for height")

    return {
        "ok": len(warnings) == 0,
        "fixture": fixture,
        # The resolved params, not what the caller sent: defaults are applied in
        # validate(), so this is the only record of what was actually cut.
        "params": params,
        "volume_mm3": stats["volume_mm3"],
        "grams_est": round(grams_for_volume(stats["volume_mm3"], density), 1),
        "tri_count": stats["tri_count"],
        "non_manifold_edges": stats["non_manifold_edges"],
        "manifold": stats["non_manifold_edges"] == 0,
        "degenerate": bool(degenerate),
        "bbox_mm": {k: round(v, 2) for k, v in bbox.items()},
        "fits_build_volume": fits_build_volume(bbox),
        "warnings": warnings,
    }
