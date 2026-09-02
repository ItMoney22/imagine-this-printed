# Print Factory Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a machine-agnostic Blender fixture runner, then prove it with two
independent product lines — Darrell's `qr_plaque` (no Tripo) and the
`candle_cradle` (Tripo shell + fixture union) — each producing a real printed part.

**Architecture:** A **pure-Python core** (params, QR matrix, metrics math — fully
unit-testable with pytest) plus a **thin Blender adapter** (`prep.py`) that runs
headless. Every fixture implements one interface and every run emits the same
`metrics.json`. That JSON is the seam the QA gate, the costing step and the
Saturn bridge all consume later.

**Tech Stack:** Python 3.12 (system, for the core + tests), Blender 4.x headless
(geometry), `segno` (QR matrices, pure-Python, no deps), Bambu Studio CLI
(Phase 3 costing — not this plan), pytest.

**Design doc:** `docs/plans/2026-09-01-photo-to-printable-pipeline-design.md`

---

## Sequencing — read this before starting

The two product lines are parallel, **but the core is not.** Both lines consume
the same fixture interface and the same `metrics.json`. If two sessions build
fixtures before the core contract is merged, they will diverge and one will be
rewritten.

```
Tasks 0–6   CORE        one branch, merge it, THEN fork
                        (small and short-lived, per CLAUDE.md)
   |
   +--> Tasks 7–10   qr_plaque line      \  parallel worktrees,
   +--> Tasks 11–14  candle_cradle line  /  independent after core lands
```

Per CLAUDE.md multi-session git discipline: **never `git checkout` in the shared
checkout.** Each branch gets its own worktree:

```bash
git worktree add "../itp-worktrees/print-factory-core" -b earth/zero-nine/print-factory-core
# after core merges:
git worktree add "../itp-worktrees/qr-plaque"    -b earth/zero-nine/qr-plaque
git worktree add "../itp-worktrees/candle-cradle" -b earth/zero-nine/candle-cradle
```

### Scope note

This adds a new top-level directory `tools/print-factory/`. `TASK_NOTES.md` must
have `tools/print-factory/**` added to the approved shortlist before Task 1
(Task 0 does this).

**Why in the ITP repo and not Saturn's:** ITP owns the product definitions, the
tiers and the bridge. One source of truth; Saturn checks the repo out and runs it.

---

## Task 0: Prerequisites — ✅ DONE 2026-09-01

**Environment is live on the Earth machine. Recorded here so Saturn can match it.**

### What was installed

**Blender 5.2.1 LTS**, portable build, at:

```
C:\Users\David\AppData\Local\Programs\blender-5.2.1-windows-x64\blender.exe
```

Persisted as a **User** environment variable `BLENDER`, and its directory added
to the User `PATH`. Open a new shell to pick both up.

Install notes worth keeping (they will recur on Saturn):

- `winget install BlenderFoundation.Blender` **fails** — it pulls from
  `download.blender.org`, which returns **403 to this network for every path**,
  directory listings included, while `blender.org` itself resolves fine.
  Use an official mirror instead: `https://mirrors.dotsrc.org/blender/release/`
  (also verified working: nluug.nl, freedif.org, rwth-aachen.de).
- The **MSI installer fails with 1603** — it begins, then rolls back for lack of
  elevation. Do not fight it. The **portable ZIP needs no admin**, which suits a
  headless render node better anyway: unzip anywhere, point `$BLENDER` at it.
- The MSI's Authenticode signature was verified `Valid`, signer
  `CN=Blender Foundation, O=Blender Foundation, Amsterdam, NL`.

### API probe — every operator this plan uses is confirmed present on 5.2.1

| Dependency | Result |
|---|---|
| `bpy.ops.object.voxel_remesh` | ✅ |
| `mesh.remesh_voxel_size` attribute | ✅ |
| `BOOLEAN` modifier + `EXACT` solver | ✅ |
| `SOLIDIFY` modifier | ✅ |
| `bpy.ops.wm.stl_export` | ✅ (`export_mesh.stl` also still present) |
| `bpy.ops.object.modifier_apply` | ✅ |
| `bmesh.calc_volume(signed=True)` on a 20mm cube | ✅ **exactly 8000.0 mm³** |
| non-manifold edge count on a clean cube | ✅ 0 |

Bundled Python is **3.13.13**. Because 5.2.1 is an **LTS** release, the earlier
concern about tracking a bleeding-edge major version does not apply — pin to it.

That cube result is the literal assertion in Task 6
(`test_20mm_cube_reports_correct_volume`), so the metrics contract is already
validated against the real engine before a line of fixture code exists.

### System-side Python (the pure core + tests)

`C:\Python312\python.exe`, with `segno` and `pytest 9.0.2` installed and
verified — `segno.make("https://imaginethisprinted.com", error="h")` yields a
33×33 module matrix, which with the 4-module quiet zone is 41×41, i.e. a **~66mm
plaque at 1.6mm modules.** Comfortably inside the A1.

Note the deliberate split: `segno` lives on the **system** interpreter, never
inside Blender's. Blender's bundled Python cannot easily `pip install`, so QR
matrices are computed outside and passed in as plain data.

**Remaining step: update TASK_NOTES.md scope**

Add to the approved shortlist: `tools/print-factory/**`, and a work-log bullet
noting the new directory and why.

**Step 4: Commit**

```bash
git add TASK_NOTES.md
git commit -m "chore: add tools/print-factory to approved scope"
```

---

## Task 1: Python package skeleton + metrics math

The grams calculation is pure arithmetic and needs no Blender, so it is written
test-first and proves the test harness works.

**Files:**
- Create: `tools/print-factory/pyproject.toml`
- Create: `tools/print-factory/printfactory/__init__.py`
- Create: `tools/print-factory/printfactory/metrics.py`
- Test: `tools/print-factory/tests/test_metrics.py`

**Step 1: Write the failing test**

```python
# tools/print-factory/tests/test_metrics.py
import pytest
from printfactory.metrics import grams_for_volume, PLA_DENSITY

def test_grams_for_one_cubic_cm_of_pla():
    # 1000 mm3 == 1 cm3; PLA is 1.24 g/cm3
    assert grams_for_volume(1000.0) == pytest.approx(1.24)

def test_grams_scales_linearly():
    assert grams_for_volume(204_000.0) == pytest.approx(252.96, rel=1e-3)

def test_density_is_overridable_for_petg():
    # PETG ~1.27 g/cm3 - the material decision is per-product, not global
    assert grams_for_volume(1000.0, density=1.27) == pytest.approx(1.27)

def test_zero_volume_is_zero_grams():
    assert grams_for_volume(0.0) == 0.0

def test_negative_volume_is_rejected():
    # a signed mesh volume < 0 means inverted normals, not a real solid
    with pytest.raises(ValueError, match="negative"):
        grams_for_volume(-5.0)
```

**Step 2: Run it and confirm it fails**

```bash
cd "tools/print-factory" && python -m pytest tests/test_metrics.py -v
```

Expected: `ModuleNotFoundError: No module named 'printfactory'`.

**Step 3: Minimal implementation**

```python
# tools/print-factory/printfactory/metrics.py
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
```

`pyproject.toml`:

```toml
[project]
name = "printfactory"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = ["segno>=1.6"]

[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[tool.pytest.ini_options]
pythonpath = ["."]
```

`printfactory/__init__.py` is empty.

**Step 4: Run and confirm pass**

```bash
cd "tools/print-factory" && python -m pytest tests/test_metrics.py -v
```

Expected: 5 passed.

**Step 5: Commit**

```bash
git add tools/print-factory/
git commit -m "feat(print-factory): filament mass calculation"
```

---

## Task 2: Build-volume and stability checks

**Files:**
- Modify: `tools/print-factory/printfactory/metrics.py`
- Test: `tools/print-factory/tests/test_limits.py`

**Step 1: Write the failing test**

```python
# tools/print-factory/tests/test_limits.py
import pytest
from printfactory.metrics import fits_build_volume, A1_BUILD_MM, tip_risk

def test_candle_holder_fits_the_a1():
    assert fits_build_volume({"x": 95, "y": 95, "z": 200}) is True

def test_too_tall_for_the_a1_is_rejected():
    assert fits_build_volume({"x": 95, "y": 95, "z": 300}) is False

def test_a1_build_volume_is_256_cubed():
    assert A1_BUILD_MM == {"x": 256, "y": 256, "z": 256}

def test_a1_mini_ceiling_is_lower():
    assert fits_build_volume({"x": 95, "y": 95, "z": 200},
                             build={"x": 180, "y": 180, "z": 180}) is False

def test_narrow_base_under_a_tall_body_is_flagged():
    # 200mm tall on a 60mm base carrying a 2lb jar = tipping
    assert tip_risk(height_mm=200, base_width_mm=60) is True

def test_wide_base_is_safe():
    assert tip_risk(height_mm=200, base_width_mm=110) is False
```

**Step 2: Run and confirm it fails**

```bash
cd "tools/print-factory" && python -m pytest tests/test_limits.py -v
```

Expected: `ImportError: cannot import name 'fits_build_volume'`.

**Step 3: Implement**

```python
# append to printfactory/metrics.py

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
```

**Step 4: Run and confirm pass**

```bash
cd "tools/print-factory" && python -m pytest -v
```

Expected: 11 passed.

**Step 5: Commit**

```bash
git add tools/print-factory/
git commit -m "feat(print-factory): build volume and tip-risk checks"
```

---

## Task 3: The job spec (the contract both lines share)

**Files:**
- Create: `tools/print-factory/printfactory/spec.py`
- Test: `tools/print-factory/tests/test_spec.py`

**Step 1: Write the failing test**

```python
# tools/print-factory/tests/test_spec.py
import pytest
from printfactory.spec import JobSpec, SpecError

def test_minimal_qr_spec_needs_no_shell():
    s = JobSpec.from_dict({"fixture": "qr_plaque", "params": {"payload": "https://x.co"}})
    assert s.fixture == "qr_plaque"
    assert s.shell_glb is None

def test_candle_spec_carries_a_shell_and_height():
    s = JobSpec.from_dict({
        "fixture": "candle_cradle",
        "params": {"jar_dia": 89},
        "shell_glb": "/tmp/shell.glb",
        "target_height_mm": 200,
    })
    assert s.shell_glb == "/tmp/shell.glb"
    assert s.target_height_mm == 200

def test_defaults_match_the_design_doc():
    s = JobSpec.from_dict({"fixture": "qr_plaque", "params": {}})
    assert s.wall_mm == 2.4
    assert s.voxel_mm == 0.6
    assert s.density == 1.24

def test_unknown_fixture_is_rejected():
    with pytest.raises(SpecError, match="unknown fixture"):
        JobSpec.from_dict({"fixture": "teapot", "params": {}})

def test_missing_fixture_is_rejected():
    with pytest.raises(SpecError, match="fixture"):
        JobSpec.from_dict({"params": {}})

def test_wall_thinner_than_two_nozzle_widths_is_rejected():
    # 0.4mm nozzle: anything under 0.8mm cannot be printed as a wall
    with pytest.raises(SpecError, match="wall_mm"):
        JobSpec.from_dict({"fixture": "qr_plaque", "params": {}, "wall_mm": 0.5})
```

**Step 2: Run and confirm it fails**

```bash
cd "tools/print-factory" && python -m pytest tests/test_spec.py -v
```

Expected: `ModuleNotFoundError: No module named 'printfactory.spec'`.

**Step 3: Implement**

```python
# tools/print-factory/printfactory/spec.py
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
```

**Step 4: Run and confirm pass**

```bash
cd "tools/print-factory" && python -m pytest -v
```

Expected: 17 passed.

**Step 5: Commit**

```bash
git add tools/print-factory/
git commit -m "feat(print-factory): job spec contract"
```

---

## Task 4: Fixture interface + registry

**Files:**
- Create: `tools/print-factory/printfactory/fixtures/__init__.py`
- Create: `tools/print-factory/printfactory/fixtures/base.py`
- Test: `tools/print-factory/tests/test_fixture_registry.py`

**Step 1: Write the failing test**

```python
# tools/print-factory/tests/test_fixture_registry.py
import pytest
from printfactory.fixtures.base import register, get_fixture, Fixture, FixtureError

def test_registered_fixture_is_retrievable():
    @register("dummy")
    class Dummy(Fixture):
        def validate(self, params): return {"ok": True}
        def build(self, params, ctx): return None
    assert get_fixture("dummy") is Dummy

def test_unregistered_fixture_raises():
    with pytest.raises(FixtureError, match="no fixture"):
        get_fixture("nope")

def test_fixture_must_implement_build():
    with pytest.raises(TypeError):
        Fixture()  # abstract
```

**Step 2: Run and confirm it fails**

```bash
cd "tools/print-factory" && python -m pytest tests/test_fixture_registry.py -v
```

Expected: `ModuleNotFoundError`.

**Step 3: Implement**

```python
# tools/print-factory/printfactory/fixtures/base.py
"""Fixture interface.

A fixture is a GEOMETRY PROGRAM. Given params it returns exact, printable
functional geometry - mm units, Z-up, resting on Z=0. It never guesses.

`validate` is pure (no Blender) so it is unit-testable on any machine.
`build` runs only inside Blender.
"""
from abc import ABC, abstractmethod

class FixtureError(Exception):
    pass

_REGISTRY: dict[str, type] = {}

def register(name: str):
    def deco(cls):
        _REGISTRY[name] = cls
        return cls
    return deco

def get_fixture(name: str) -> type:
    if name not in _REGISTRY:
        raise FixtureError(f"no fixture registered as {name!r}")
    return _REGISTRY[name]

class Fixture(ABC):
    @abstractmethod
    def validate(self, params: dict) -> dict:
        """Normalise + range-check params. Pure Python. Raises FixtureError."""

    @abstractmethod
    def build(self, params: dict, ctx):
        """Return a Blender mesh object. Called inside Blender only."""
```

**Step 4: Run and confirm pass**

```bash
cd "tools/print-factory" && python -m pytest -v
```

Expected: 20 passed.

**Step 5: Commit**

```bash
git add tools/print-factory/
git commit -m "feat(print-factory): fixture interface and registry"
```

---

## Task 5: The Blender runner (`prep.py`)

This is the adapter. Keep it thin — logic belongs in the pure-Python modules.

### ✅ The full op chain was smoke-tested on Blender 5.2.1 before this task

Verified live 2026-09-01 — cube → voxel remesh → UNION (EXACT) → Solidify hollow
→ decimate → `wm.stl_export`:

| Step | Volume mm³ | Non-manifold edges | Tris |
|---|---|---|---|
| 40mm cube | 64,000.0 | 0 | 12 |
| after voxel remesh (0.8mm) | **64,000.0** | 0 | 31,212 |
| after UNION with cylinder | 72,989.8 | 0 | 30,164 |
| after Solidify hollow (2.4mm) | **23,608.6** | 0 | 60,328 |
| after decimate (0.5) | — | 0 | 30,164 |
| `wm.stl_export` | 1.5MB file written | | |

Two findings that de-risk the whole design:

1. **Voxel remesh preserved volume exactly** (64,000.0 → 64,000.0). The step most
   likely to corrupt the filament estimate does not.
2. **Hollowing cut material 68%** (72,989 → 23,608 mm³). §5's economic argument is
   now measured, not asserted.

Manifold held at every stage — so the "boolean on a remeshed mesh stays clean"
assumption is sound. Expect failures only on genuinely messy Tripo input.

Confirmed signatures: `wm.stl_export(filepath, export_selected_objects,
ascii_format, global_scale)`; `bpy.ops.object.select_all` is safe in background
mode on an empty scene.

**Files:**
- Create: `tools/print-factory/prep.py`
- Create: `tools/print-factory/printfactory/blender_ops.py`

**Step 1: Write `blender_ops.py`**

```python
# tools/print-factory/printfactory/blender_ops.py
"""Blender-only helpers. Never imported by tests - `import bpy` fails outside."""
import bpy, bmesh
from mathutils import Vector

def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def voxel_remesh(obj, voxel_mm: float):
    """Guarantees a manifold solid. Non-optional before any boolean - Tripo
    meshes self-intersect and EXACT booleans produce garbage on them."""
    obj.data.remesh_voxel_size = voxel_mm
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.voxel_remesh()

def boolean(target, tool, operation: str):
    m = target.modifiers.new(name=f"bool_{operation.lower()}", type="BOOLEAN")
    m.operation = operation          # 'UNION' | 'DIFFERENCE' | 'INTERSECT'
    m.solver = "EXACT"
    m.object = tool
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.data.objects.remove(tool, do_unlink=True)

def hollow(obj, wall_mm: float):
    m = obj.modifiers.new(name="solidify", type="SOLIDIFY")
    m.thickness = wall_mm
    m.offset = -1.0                  # inward, preserving the outer surface
    m.use_even_offset = True
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=m.name)

def mesh_stats(obj) -> dict:
    """Signed volume (mm3) and non-manifold edge count, straight from bmesh.
    Avoids object_print3d_utils, whose report API is awkward to read."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    volume = bm.calc_volume(signed=True)
    non_manifold = sum(1 for e in bm.edges if not e.is_manifold)
    tris = sum(len(f.verts) - 2 for f in bm.faces)
    bm.free()
    return {"volume_mm3": abs(volume), "non_manifold_edges": non_manifold,
            "tri_count": tris}

def bbox_mm(obj) -> dict:
    cs = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    xs = [c.x for c in cs]; ys = [c.y for c in cs]; zs = [c.z for c in cs]
    return {"x": max(xs)-min(xs), "y": max(ys)-min(ys), "z": max(zs)-min(zs)}
```

**Two bugs fixed here vs. the first draft of this plan** (found while smoke-testing):

- `from mathutils import Vector` was written at the *bottom* of the file, after
  the function using it. It happens to work at runtime, but it is fragile and
  misleading — it now sits with the other imports at the top.
- `prep.py` below imports `printfactory.fixtures.registry_import`, which the
  first draft never defined. Create it in this task as an explicit import list;
  a fixture that is never imported is never registered, and `get_fixture` would
  raise for a fixture that plainly exists on disk:

```python
# tools/print-factory/printfactory/fixtures/registry_import.py
"""Importing this module registers every fixture. prep.py imports it for the
side effect - without it the registry is empty and get_fixture() always fails."""
from printfactory.fixtures import qr_plaque  # noqa: F401
# from printfactory.fixtures import candle_cradle  # noqa: F401  (Task 11)
```

**Step 2: Write `prep.py`**

```python
# tools/print-factory/prep.py
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

def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)

    spec = JobSpec.from_dict(json.load(open(args.spec)))
    os.makedirs(args.out, exist_ok=True)

    from printfactory import blender_ops as ops
    ops.clear_scene()

    fixture = get_fixture(spec.fixture)()
    params = fixture.validate(spec.params)
    obj = fixture.build(params, ctx=spec)

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

    import bpy
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.ops.wm.stl_export(filepath=os.path.join(args.out, "model.stl"),
                          export_selected_objects=True)
    json.dump(metrics, open(os.path.join(args.out, "metrics.json"), "w"), indent=2)
    print("METRICS", json.dumps(metrics))

if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    main(argv)
```

**Note:** `bpy.ops.wm.stl_export` is confirmed present on the installed 5.2.1 LTS
(Task 0 probe), as is the legacy `bpy.ops.export_mesh.stl(filepath=...,
use_selection=True)`. Use `wm.stl_export`; keep the legacy name in mind only if
Saturn ends up on Blender 4.0/4.1, where `wm.stl_export` does not exist.

**Step 3: Commit** (no test yet — Task 6 is the integration test)

```bash
git add tools/print-factory/
git commit -m "feat(print-factory): headless blender runner"
```

---

## ⚠ Blender exits 0 on an uncaught exception — every caller must pass `--python-exit-code`

Found while building Task 6, then verified directly on 5.2.1:

| invocation | exit code |
|---|---|
| script raises an uncaught exception | **0** |
| script calls `sys.exit(1)` | 1 |
| raises **+ `--python-exit-code 1`** | **1** |

A crashed `prep.py` — bad spec, boolean failure, out of memory — is otherwise
**indistinguishable from a successful run**: exit 0, no artifacts, no error.
`assert returncode == 0` on its own is a check that can never fail.

Every invocation of `prep.py` must therefore be:

```bash
"$BLENDER" --background --factory-startup --python-exit-code 1 \
    --python prep.py -- --spec spec.json --out outdir
```

**This is a Phase 2 contract requirement, not just a test detail.** When Saturn
shells out over the print bridge without this flag, it will report failed jobs
as complete with no STL attached, and the failure will surface much later as a
missing file rather than a failed job.

Fixed in `ea69bf4`. The integration test also asserts `metrics.json` exists as
direct evidence the run reached the end, not merely that the process survived.

## Task 6: Integration test — a cube through the whole pipe

Proves the runner end-to-end before either product line depends on it.

**Files:**
- Create: `tools/print-factory/printfactory/fixtures/_selftest.py`
- Create: `tools/print-factory/printfactory/fixtures/registry_import.py`
- Test: `tools/print-factory/tests/test_runner_integration.py`

**Step 1: Write the failing test**

```python
# tools/print-factory/tests/test_runner_integration.py
import json, os, subprocess, tempfile, shutil
import pytest

BLENDER = os.environ.get("BLENDER")
pytestmark = pytest.mark.skipif(not BLENDER or not os.path.exists(BLENDER),
                                reason="BLENDER env var not set to a real install")

def run_spec(spec: dict) -> dict:
    d = tempfile.mkdtemp()
    try:
        sp = os.path.join(d, "spec.json")
        json.dump(spec, open(sp, "w"))
        out = os.path.join(d, "out")
        root = os.path.join(os.path.dirname(__file__), "..")
        r = subprocess.run([BLENDER, "--background", "--factory-startup",
                            "--python", os.path.join(root, "prep.py"),
                            "--", "--spec", sp, "--out", out],
                           capture_output=True, text=True, timeout=300)
        assert r.returncode == 0, r.stdout + r.stderr
        return json.load(open(os.path.join(out, "metrics.json")))
    finally:
        shutil.rmtree(d, ignore_errors=True)

def test_20mm_cube_reports_correct_volume():
    m = run_spec({"fixture": "qr_plaque", "params": {"_selftest_cube_mm": 20}})
    # 20^3 = 8000 mm3, within voxel/decimate tolerance
    assert m["volume_mm3"] == pytest.approx(8000, rel=0.05)

def test_cube_is_manifold():
    m = run_spec({"fixture": "qr_plaque", "params": {"_selftest_cube_mm": 20}})
    assert m["manifold"] is True
    assert m["non_manifold_edges"] == 0

def test_cube_fits_the_build_volume():
    m = run_spec({"fixture": "qr_plaque", "params": {"_selftest_cube_mm": 20}})
    assert m["fits_build_volume"] is True
    assert m["ok"] is True

def test_stl_file_is_actually_written():
    # regression guard: metrics.json can be written even if the export silently no-ops
    pass  # implement alongside run_spec returning the out dir
```

**Step 2: Run and confirm it fails**

```bash
cd "tools/print-factory" && BLENDER="$BLENDER" python -m pytest tests/test_runner_integration.py -v
```

Expected: failure (no fixture handles `_selftest_cube_mm`). If it *skips*, the
`BLENDER` env var is not set — fix that first, a skipped test proves nothing.

**Step 3: Implement the selftest escape hatch**

In the `qr_plaque` fixture (Task 7), honour `_selftest_cube_mm` by returning a
plain cube of that size. It keeps the runner testable without a real QR.

**Step 4: Run and confirm pass**

**Step 5: Commit**

```bash
git add tools/print-factory/
git commit -m "test(print-factory): end-to-end runner integration"
```

**>>> MERGE THE CORE BRANCH HERE before starting Task 7 or Task 11. <<<**

---

# LINE A — `qr_plaque` (Darrell's business products)

## Task 6b: Close the KNOWN_FIXTURES / registry drift (do this first)

Surfaced during Task 4 review. `spec.py` holds a hardcoded
`KNOWN_FIXTURES = {"qr_plaque", "candle_cradle", ...}` while `fixtures/base.py`
holds the live `_REGISTRY` that fixtures register into. **These can drift**: a
fixture that registers itself but is missing from the hardcoded set is rejected
by `JobSpec.from_dict` even though it plainly exists and works — a confusing
failure with no obvious cause.

Do **not** simply make `spec.py` read the registry. The duplication is load-
bearing: `spec.py` must stay importable without any fixture (and therefore
without Blender) so the pure core keeps testing anywhere, and the registry is
only populated once `registry_import` runs.

The right fix is a **drift test**, not coupling:

```python
# tools/print-factory/tests/test_registry_consistency.py
"""KNOWN_FIXTURES is a hand-maintained catalogue; _REGISTRY is populated at
import. They must agree, or a working fixture gets rejected by JobSpec."""
from printfactory.spec import KNOWN_FIXTURES
from printfactory.fixtures.base import _REGISTRY
import printfactory.fixtures.registry_import  # noqa: F401  (populates _REGISTRY)

def test_every_registered_fixture_is_accepted_by_the_spec():
    unknown = set(_REGISTRY) - KNOWN_FIXTURES - {"dummy"}
    assert not unknown, f"registered but rejected by JobSpec: {unknown}"

def test_every_declared_fixture_is_actually_registered():
    # Fixtures still to be built are listed here as they land.
    implemented = {"_selftest", "qr_plaque"}
    missing = implemented - set(_REGISTRY)
    assert not missing, f"declared implemented but never registered: {missing}"
```

Note `_selftest` must be in `KNOWN_FIXTURES` (added in Task 5), and the `dummy`
exclusion covers the throwaway class registered by `test_fixture_registry.py`.

Also worth knowing (same review): `test_fixture_must_implement_build` passes on
the `TypeError` from instantiating the ABC, so it would still pass if only
`validate` were abstract. The test is slightly weaker than its name. Harmless —
both methods are decorated — but do not treat it as proof `build` is enforced.

**Commit:** `test(print-factory): guard KNOWN_FIXTURES against registry drift`

## Task 7: QR matrix generation (pure Python, no Blender)

The matrix is computed **outside** Blender and passed in as data. Blender's
bundled Python cannot easily `pip install`, so keeping `segno` on the system
side avoids that problem entirely — and makes the QR logic trivially testable.

**Files:**
- Create: `tools/print-factory/printfactory/qr.py`
- Test: `tools/print-factory/tests/test_qr.py`

**Step 1: Write the failing test**

```python
# tools/print-factory/tests/test_qr.py
import pytest
from printfactory.qr import qr_matrix, plaque_size_mm, MIN_MODULE_MM, QUIET_ZONE

def test_matrix_is_square_and_binary():
    m = qr_matrix("https://example.com")
    assert len(m) == len(m[0])
    assert set(v for row in m for v in row) <= {0, 1}

def test_quiet_zone_is_four_modules_each_side():
    # a QR with no quiet zone does not scan
    assert QUIET_ZONE == 4
    m = qr_matrix("https://example.com")
    assert all(v == 0 for v in m[0])          # top border row is blank
    assert all(row[0] == 0 for row in m)      # left border column is blank

def test_error_correction_defaults_to_high():
    # ECC H tolerates a print artefact destroying part of the code
    plain = qr_matrix("https://example.com", ecc="l")
    high = qr_matrix("https://example.com", ecc="h")
    assert len(high) > len(plain)

def test_module_size_floor_is_enforced():
    # below ~1.6mm a 0.4mm nozzle cannot resolve a module cleanly
    assert MIN_MODULE_MM == 1.6
    with pytest.raises(ValueError, match="module_mm"):
        plaque_size_mm("https://example.com", module_mm=0.8)

def test_plaque_size_matches_module_count():
    m = qr_matrix("https://example.com")
    size = plaque_size_mm("https://example.com", module_mm=1.6)
    assert size == pytest.approx(len(m) * 1.6)

def test_empty_payload_is_rejected():
    with pytest.raises(ValueError, match="payload"):
        qr_matrix("")
```

**Step 2: Run and confirm it fails**

```bash
cd "tools/print-factory" && python -m pytest tests/test_qr.py -v
```

**Step 3: Implement**

```python
# tools/print-factory/printfactory/qr.py
"""QR geometry inputs. Pure Python - runs on the system interpreter, not Blender.

Scannability is the whole product here. Three rules are load-bearing:
  - quiet zone: 4 blank modules on every side, or cameras will not lock on
  - module size: >=1.6mm so a 0.4mm nozzle resolves each cell
  - ECC H: a print artefact must not destroy the code
"""
import segno

QUIET_ZONE = 4
MIN_MODULE_MM = 1.6

def qr_matrix(payload: str, ecc: str = "h") -> list[list[int]]:
    if not payload:
        raise ValueError("payload must not be empty")
    qr = segno.make(payload, error=ecc)
    rows = [[1 if c else 0 for c in row] for row in qr.matrix]
    n = len(rows)
    w = n + QUIET_ZONE * 2
    out = [[0] * w for _ in range(QUIET_ZONE)]
    for r in rows:
        out.append([0] * QUIET_ZONE + r + [0] * QUIET_ZONE)
    out.extend([[0] * w for _ in range(QUIET_ZONE)])
    return out

def plaque_size_mm(payload: str, module_mm: float = MIN_MODULE_MM,
                   ecc: str = "h") -> float:
    if module_mm < MIN_MODULE_MM:
        raise ValueError(
            f"module_mm {module_mm} below {MIN_MODULE_MM}: will not scan when printed")
    return len(qr_matrix(payload, ecc)) * module_mm
```

**Step 4: Run and confirm pass**

**Step 5: Commit**

```bash
git add tools/print-factory/
git commit -m "feat(print-factory): QR matrix with quiet zone and module floor"
```

---

## Task 8: `qr_plaque` fixture geometry

**Files:**
- Create: `tools/print-factory/printfactory/fixtures/qr_plaque.py`
- Test: `tools/print-factory/tests/test_qr_plaque.py` (validate() only — pure)

Geometry: a base slab, then a **recessed pocket** one module-grid deep holding
the dark modules. The pocket is what the existing `insert_pause` rail fills with
a contrasting insert — that contrast is what makes it scan.

`validate()` must reject: empty payload, `module_mm` under the floor, and a
resulting plaque larger than the build volume. Test those three as pure Python.

`build()` creates the slab, then one cube per dark module fused into a single
mesh, then a boolean DIFFERENCE for the pocket. Batch the module cubes into one
mesh via `bmesh` before the boolean — one boolean against 400 separate objects
is pathologically slow.

**Commit:** `feat(print-factory): qr_plaque fixture`

---

## Task 9: First physical print + scan gate

**Not a code task. This is the acceptance test for Line A.**

1. Generate a plaque for a real URL (Darrell's site or a review link).
2. Slice in Bambu Studio, print on the A1 (~45 min).
3. Fill the pocket with a contrasting insert.
4. **Scan it with a phone.** It scans, or the SKU does not ship.
5. Record actual grams and minutes; compare against `metrics.json` `grams_est`
   and note the delta — that calibrates the estimator for Phase 3.

**Commit** the measured numbers into `docs/plans/` as a short results note.

---

## Task 10: Size ladder + WiFi variant

Once one plaque scans, `wifi_card` is the same fixture with a different payload
format: `WIFI:T:WPA;S:<ssid>;P:<password>;;`. Test that string builder as pure
Python (escaping `;` and `:` in SSIDs and passwords is the bug everyone ships).

**Commit:** `feat(print-factory): wifi payload builder`

---

# LINE B — `candle_cradle`

## Task 11: `candle_cradle` fixture geometry

**Files:**
- Create: `tools/print-factory/printfactory/fixtures/candle_cradle.py`
- Test: `tools/print-factory/tests/test_candle_cradle.py` (validate() only)

Params and the size ladder from the design doc §12:

| SKU | `jar_dia` |
|---|---|
| S | 76 |
| M | 89 |
| L | 104 |

`clearance` defaults to 1.2mm radial so the jar drops in without forcing.
`validate()` must reject a `jar_dia` outside 50–150mm, a negative clearance, and
a `base_width` that trips `tip_risk` against the target height. Those are pure
Python tests — write them first.

Geometry: a cylindrical platform at `platform_h`, bored to
`jar_dia + 2*clearance`, with an optional retaining ring, plus a `weight_pocket`
cavity in the base for sand.

**Commit:** `feat(print-factory): candle_cradle fixture`

---

## Task 12: Shell import + union path

Extend `prep.py` for the `shell_glb` case (Line A never exercises this):

```
import GLB -> scale to target_height_mm -> Y-up to Z-up -> centre XY -> ground
  -> voxel remesh (MANDATORY before boolean)
  -> UNION fixture
  -> DIFFERENCE cut plane at Z=0
  -> hollow(wall_mm) + vent hole
  -> decimate to face_limit
```

`backend/services/glb-to-stl.ts:23-42` already documents the scale/Z-up/ground
conventions — **match them exactly** so Blender output and the existing Node
converter agree. Divergence here produces models that are correct in one path
and sideways in the other.

**Expect boolean failures.** On failure, retry once at half `voxel_mm`, then
fail the job cleanly with a warning — never emit a bad STL.

**Commit:** `feat(print-factory): tripo shell import and fixture union`

---

## Task 13: Three SKUs from one shell

The payoff of the architecture. One Tripo generation, three cradle params,
three STLs. Add a `--sizes S,M,L` batch flag to `prep.py` that reuses the loaded
and remeshed shell across all three unions rather than re-importing.

Assert in an integration test that all three outputs are manifold and that their
bore diameters differ by exactly the ladder deltas.

**Commit:** `feat(print-factory): batch size ladder from one shell`

---

## Task 14: First physical candle holder

**Acceptance test for Line B.** Print size M (89mm) in PLA, single colour, mask
as a separate socketed part per design §12.

Gate: **it stands with a full jar in it, and the jar drops in without forcing.**
Record grams and hours against `grams_est`.

---

## What is explicitly NOT in Phase 1

Per YAGNI, and to keep branches short-lived:

- the Saturn bridge endpoints (`/model-queue`, `/model-result`) — Phase 2
- the `model_prep_jobs` table — Phase 2
- slicer CLI costing — Phase 3 (Bambu Studio is installed; CLI unvalidated)
- the IP gate upgrade — Phase 3, and it is independent of all of this
- listing/admin approval UI — Phase 4

Phase 1 succeeds when two real parts exist: a plaque a phone scans, and a
candle holder that holds a candle.
