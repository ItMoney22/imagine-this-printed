"""Headless entry point.

  blender --background --factory-startup --python prep.py -- \
      --spec spec.json --out outdir
"""
import sys, json, argparse, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from printfactory.spec import JobSpec
from printfactory.metrics import grams_for_volume, fits_build_volume, tip_risk
from printfactory.fixtures.base import get_fixture
import printfactory.fixtures.registry_import  # noqa: F401  (registers fixtures)
from printfactory import blender_ops as ops


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)

    with open(args.spec) as fh:
        spec = JobSpec.from_dict(json.load(fh))
    os.makedirs(args.out, exist_ok=True)

    ops.clear_scene()

    fixture = get_fixture(spec.fixture)()
    params = fixture.validate(spec.params)
    obj = fixture.build(params, ctx=spec)

    ops.decimate_to(obj, spec.face_limit)

    stats = ops.mesh_stats(obj)
    bbox = ops.bbox_mm(obj)
    grams = grams_for_volume(stats["volume_mm3"], spec.density)

    warnings = []
    if stats["non_manifold_edges"] > 0:
        warnings.append(f"{stats['non_manifold_edges']} non-manifold edges")
    if not fits_build_volume(bbox):
        warnings.append("exceeds A1 build volume")
    if tip_risk(bbox["z"], min(bbox["x"], bbox["y"])):
        warnings.append("tip risk: base too narrow for height")

    metrics = {
        "ok": len(warnings) == 0,
        "fixture": spec.fixture,
        "volume_mm3": stats["volume_mm3"],
        "grams_est": round(grams, 1),
        "tri_count": stats["tri_count"],
        "non_manifold_edges": stats["non_manifold_edges"],
        "manifold": stats["non_manifold_edges"] == 0,
        "bbox_mm": {k: round(v, 2) for k, v in bbox.items()},
        "fits_build_volume": fits_build_volume(bbox),
        "warnings": warnings,
    }

    ops.export_stl(obj, os.path.join(args.out, "model.stl"))
    with open(os.path.join(args.out, "metrics.json"), "w") as fh:
        json.dump(metrics, fh, indent=2)
    print("METRICS", json.dumps(metrics))


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    main(argv)
