"""Generate the candle cradle size ladder in ONE Blender session.

  blender --background --factory-startup --python-exit-code 1 \
      --python batch_sizes.py -- --out outdir --sizes S,M,L

Deliberately separate from prep.py, which stays a single-job entry point. The
whole reason this exists is process cost: Blender takes ~0.5s to start and the
cradle itself builds in well under that, so shelling out per size spends most of
the wall clock on startup. Here the interpreter, the addons and the Python
imports are paid for once and the scene is reset between sizes with
clear_scene(), which is the same fresh-state guarantee at none of the cost.

--python-exit-code 1 is as mandatory here as it is for prep.py: without it a
crashed size still exits 0 and the batch looks like it succeeded.
"""
import sys, json, argparse, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from printfactory.spec import JobSpec
from printfactory.report import build_metrics
from printfactory.fixtures.base import get_fixture
from printfactory.fixtures.candle_cradle import SIZE_LADDER
import printfactory.fixtures.registry_import  # noqa: F401  (registers fixtures)
from printfactory import blender_ops as ops

# Everything except jar_dia comes from the fixture's own defaults.
DEFAULT_SPEC = {"fixture": "candle_cradle", "params": {}}


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--sizes", default="S,M,L",
                    help="comma-separated keys from the ladder, e.g. S,M,L")
    ap.add_argument("--spec", default=None,
                    help="optional base spec json; jar_dia is overridden per size")
    args = ap.parse_args(argv)

    sizes = [s.strip().upper() for s in args.sizes.split(",") if s.strip()]
    if not sizes:
        raise ValueError("--sizes selected nothing")
    unknown = [s for s in sizes if s not in SIZE_LADDER]
    if unknown:
        # Loud, not skipped: a typo'd size silently producing two of three SKUs
        # is a shipping error nobody notices until a box is short.
        raise ValueError(f"unknown size(s) {unknown}; ladder is "
                         f"{sorted(SIZE_LADDER)}")

    if args.spec:
        with open(args.spec) as fh:
            base = json.load(fh)
    else:
        base = dict(DEFAULT_SPEC)

    os.makedirs(args.out, exist_ok=True)
    results = {}

    for size in sizes:
        job = dict(base)
        job["params"] = {**base.get("params", {}), "jar_dia": SIZE_LADDER[size]}
        spec = JobSpec.from_dict(job)

        # The reuse point: same process, same imports, empty scene.
        ops.clear_scene()

        fixture = get_fixture(spec.fixture)()
        params = fixture.validate(spec.params)
        obj = fixture.build(params, ctx=spec)
        ops.decimate_to(obj, spec.face_limit)

        metrics = build_metrics(spec.fixture, params, ops.mesh_stats(obj),
                                ops.bbox_mm(obj), spec.density)
        metrics["size"] = size

        size_dir = os.path.join(args.out, size)
        os.makedirs(size_dir, exist_ok=True)
        ops.export_stl(obj, os.path.join(size_dir, "model.stl"))
        with open(os.path.join(size_dir, "metrics.json"), "w") as fh:
            json.dump(metrics, fh, indent=2)

        results[size] = metrics
        print(f"SIZE {size}", json.dumps(metrics))

    index = {
        "fixture": base.get("fixture", DEFAULT_SPEC["fixture"]),
        "sizes": sizes,
        "results": results,
    }
    with open(os.path.join(args.out, "batch.json"), "w") as fh:
        json.dump(index, fh, indent=2)
    print("BATCH", json.dumps({"sizes": sizes,
                               "grams": {s: results[s]["grams_est"] for s in sizes}}))


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    main(argv)
