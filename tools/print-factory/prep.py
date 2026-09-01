"""Headless entry point.

  blender --background --factory-startup --python prep.py -- \
      --spec spec.json --out outdir
"""
import sys, json, argparse, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from printfactory.spec import JobSpec
from printfactory.report import build_metrics
from printfactory.fixtures.base import get_fixture
import printfactory.fixtures.registry_import  # noqa: F401  (registers fixtures)
from printfactory import blender_ops as ops
from printfactory import compose


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)

    with open(args.spec) as fh:
        spec = JobSpec.from_dict(json.load(fh))
    # A relative shell path resolves against the SPEC, not the cwd: Blender is
    # launched from wherever the caller happens to be, so a spec that only
    # works from one directory is a spec that works by luck.
    if spec.shell_glb and not os.path.isabs(spec.shell_glb):
        spec.shell_glb = os.path.normpath(os.path.join(
            os.path.dirname(os.path.abspath(args.spec)), spec.shell_glb))
    os.makedirs(args.out, exist_ok=True)

    ops.clear_scene()

    fixture = get_fixture(spec.fixture)()
    params = fixture.validate(spec.params)

    if spec.shell_glb:
        # Shell jobs own their own scene lifecycle: fuse() re-imports and
        # rebuilds from scratch per boolean attempt, so it clears the scene
        # itself rather than inheriting whatever a failed attempt left behind.
        obj, extras = compose.fuse(spec, fixture, params)
    else:
        obj = fixture.build(params, ctx=spec)
        ops.decimate_to(obj, spec.face_limit)
        extras = {}

    metrics = build_metrics(spec.fixture, params, ops.mesh_stats(obj),
                            ops.bbox_mm(obj), spec.density)
    metrics.update(extras)

    ops.export_stl(obj, os.path.join(args.out, "model.stl"))
    with open(os.path.join(args.out, "metrics.json"), "w") as fh:
        json.dump(metrics, fh, indent=2)
    print("METRICS", json.dumps(metrics))


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    main(argv)
