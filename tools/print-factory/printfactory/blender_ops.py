"""Blender-only helpers. Never imported by tests - `import bpy` fails outside."""
import math

import bpy, bmesh
from mathutils import Vector, Matrix

from printfactory.shellprep import ShellError, normalise_plan

def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def _make_active(obj):
    """Operators poll on the active object AND the selection. Setting only the
    active object leaves ops.object.voxel_remesh() silently unpolled in a
    background scene where nothing was ever selected."""
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

def voxel_remesh(obj, voxel_mm: float):
    """Guarantees a manifold solid. Non-optional before any boolean - generated
    meshes self-intersect and EXACT booleans produce garbage on them."""
    obj.data.remesh_voxel_size = voxel_mm
    _make_active(obj)
    bpy.ops.object.voxel_remesh()

def boolean(target, tool, operation: str, use_self: bool = False):
    m = target.modifiers.new(name=f"bool_{operation.lower()}", type="BOOLEAN")
    m.operation = operation          # 'UNION' | 'DIFFERENCE' | 'INTERSECT'
    m.solver = "EXACT"
    # Off by default: it is markedly slower and only earns its keep on a target
    # that still self-intersects, which after a voxel remesh it should not.
    m.use_self = use_self
    m.object = tool
    _make_active(target)
    bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.data.objects.remove(tool, do_unlink=True)

def hollow(obj, wall_mm: float):
    m = obj.modifiers.new(name="solidify", type="SOLIDIFY")
    m.thickness = wall_mm
    m.offset = -1.0                  # inward, preserving the outer surface
    m.use_even_offset = True
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=m.name)

def decimate_to(obj, face_limit: int):
    """Reduce to at most face_limit triangles. No-op if already under."""
    tris = mesh_stats(obj)["tri_count"]
    if tris <= face_limit:
        return
    m = obj.modifiers.new(name="decimate", type="DECIMATE")
    m.ratio = face_limit / tris
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

def bounds_mm(obj) -> tuple:
    """World-space (min, max) corners, computed from the vertices.

    Deliberately NOT obj.bound_box: that is a cache on the object, and it is
    still holding the PRE-transform extents right after obj.data.transform().
    Measured, not assumed - a normalise pass written against bound_box scaled a
    200mm figure correctly and then centred it using the unscaled bounds, so the
    model came out 0.5mm off the plate instead of 100mm. Vertices never lie.
    """
    mw = obj.matrix_world
    cs = [mw @ v.co for v in obj.data.vertices]
    if not cs:
        raise ShellError(f"{obj.name} has no vertices; nothing to measure")
    xs = [c.x for c in cs]; ys = [c.y for c in cs]; zs = [c.z for c in cs]
    return ((min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs)))


def bbox_mm(obj) -> dict:
    mn, mx = bounds_mm(obj)
    return {"x": mx[0]-mn[0], "y": mx[1]-mn[1], "z": mx[2]-mn[2]}

def export_stl(obj, filepath: str):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.wm.stl_export(filepath=filepath, export_selected_objects=True)


# --- generative shell import -------------------------------------------

def import_glb(filepath: str):
    """Import a GLB and return ONE mesh object with its transforms baked in.

    TRELLIS and friends emit a scene, not a mesh: the real examples/shell.glb
    arrives as a mesh plus a 'world' EMPTY parent. Everything that is not a mesh
    is discarded and every mesh is joined, because every downstream step - the
    remesh, the booleans, the export - takes a single object.

    No rotation is applied here. Blender's glTF importer already performs the
    Y-up -> Z-up conversion that glb-to-stl.ts does with makeRotationX(-pi/2);
    see printfactory/shellprep.py for the measurement that proves it.
    """
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=filepath)
    imported = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in imported if o.type == "MESH"]
    if not meshes:
        raise ShellError(
            f"{filepath} contained no mesh objects "
            f"(imported: {[(o.name, o.type) for o in imported]})"
        )

    for o in imported:
        if o.type != "MESH":
            bpy.data.objects.remove(o, do_unlink=True)

    obj = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.select_all(action="DESELECT")
        for m in meshes:
            m.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.join()
        obj = bpy.context.view_layer.objects.active

    # Bake the node transform into the vertices. glTF nests meshes under scene
    # nodes; leaving that on the object means every later measurement has to
    # remember to multiply by matrix_world, and one place that forgets ships a
    # model at the wrong scale.
    obj.data.transform(obj.matrix_world)
    obj.matrix_world.identity()
    obj.data.update()
    obj.name = "shell"
    return obj


def normalise_shell(obj, target_height_mm: float) -> dict:
    """Scale to target height, centre on XY, rest the lowest point on Z=0.

    Matches backend/services/glb-to-stl.ts exactly so a shell prepped here and
    a shell prepped by the Node converter are the same part.
    """
    mn, mx = bounds_mm(obj)
    plan = normalise_plan(mn, mx, target_height_mm)
    obj.data.transform(Matrix.Scale(plan["scale"], 4))
    obj.data.transform(Matrix.Translation(Vector(plan["translate"])))
    obj.data.update()
    return plan


# --- cutters, base, probing --------------------------------------------

def cylinder(dia: float, z0: float, z1: float, name: str = "cutter",
             segments: int = 128):
    """Z-axis cylinder spanning exactly z0..z1, centred on XY."""
    depth = z1 - z0
    if depth <= 0:
        raise ShellError(f"cylinder {name}: z1 {z1} is not above z0 {z0}")
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=segments, radius=dia / 2.0, depth=depth,
        location=(0.0, 0.0, z0 + depth / 2.0),
    )
    obj = bpy.context.active_object
    obj.name = name
    return obj


def bake_transform(obj):
    """Apply loc/rot/scale so object space == world space.

    The fixture builds its body with a location offset, so a 200mm cradle
    carries a +100mm Z translation on its object origin. Every subsequent
    step that thinks in world millimetres - the bisect plane, the ray probe -
    then has to remember to convert, and the one that forgets is wrong by
    exactly half the part.
    """
    _make_active(obj)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def flatten_base(obj, z: float = 0.0):
    """Guarantee a dead-flat base by removing everything below `z`.

    A voxel remesh resamples the surface, so a shell grounded at exactly Z=0
    comes back out of the remesh dipping a fraction of a voxel below it - the
    part then balances on a rounded nub instead of a flat annulus.

    Done with a bmesh bisect, NOT a boolean against a half-space box, and that
    is not a stylistic choice. The box's top face is coplanar with the part's
    own flat bottom by construction, and coplanar input is precisely where the
    EXACT solver fails: measured on the real wraith union, the boolean version
    took a 189,724-triangle, 1,216,629mm3 solid and returned 546 triangles and
    12mm3 - it deleted the product and reported success, because what was left
    was still watertight. A bisect never invokes the solver at all.
    """
    bake_transform(obj)
    mn, _mx = bounds_mm(obj)
    if mn[2] >= z - 1e-6:
        return False

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    res = bmesh.ops.bisect_plane(
        bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-5,
        plane_co=(0.0, 0.0, z), plane_no=(0.0, 0.0, 1.0),
        clear_inner=True, clear_outer=False,
    )
    cut_edges = [g for g in res["geom_cut"] if isinstance(g, bmesh.types.BMEdge)]
    if cut_edges:
        bmesh.ops.holes_fill(bm, edges=cut_edges, sides=0)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return True


def probe_column(obj, dia: float, z_from: float, rings: int = 4,
                 spokes: int = 8) -> dict:
    """Ray-cast straight down inside a cylinder and report what stops the ray.

    This is how we prove the jar still fits. After the shell is unioned onto the
    cradle, the shell's own geometry can be sitting in the bore - a solid figure
    welded over the cavity looks perfect by every other metric (manifold, right
    bbox, sane mass) and is a worthless product, because the thing it exists to
    hold no longer goes in it.

    Returns the DEEPEST first-hit (`first_hit_z_max`): the highest obstruction
    anywhere in the column, i.e. how far down a flat-bottomed jar of this
    diameter can actually descend.
    """
    bpy.context.view_layer.update()
    # Object.ray_cast works in OBJECT space, and the cradle's origin is not at
    # the world origin - the fixture builds its body cylinder with a location
    # offset, so obj.matrix_world carries a +100mm Z translation on a 200mm
    # part. Probing in raw local coordinates reported the platform floor at
    # z=75 while every other measurement in the pipeline called it z=175, and
    # the ray origin landed somewhere the mesh was not. Everything here is
    # world space in, world space out.
    inv = obj.matrix_world.inverted()
    r = dia / 2.0
    points = [(0.0, 0.0)]
    for i in range(1, rings + 1):
        # The outermost ring sits exactly on the jar's own circumference: that
        # is where a shoulder of unioned shell would foul the jar first.
        rr = r * i / float(rings)
        for k in range(spokes):
            a = 2.0 * math.pi * k / spokes
            points.append((rr * math.cos(a), rr * math.sin(a)))

    misses, hits = 0, []
    down = (inv.to_3x3() @ Vector((0.0, 0.0, -1.0))).normalized()
    for (x, y) in points:
        origin = inv @ Vector((x, y, z_from))
        ok, loc, _n, _i = obj.ray_cast(origin, down)
        if ok:
            hits.append((obj.matrix_world @ loc).z)
        else:
            misses += 1
    return {
        "samples": len(points),
        "misses": misses,
        "first_hit_z_max": max(hits) if hits else None,
        "first_hit_z_min": min(hits) if hits else None,
    }


def snapshot(obj):
    """A throwaway copy of obj's mesh, so a destructive step can be reverted."""
    return obj.data.copy()


def restore(obj, snap):
    old = obj.data
    obj.data = snap
    if old.users == 0:
        bpy.data.meshes.remove(old)


def discard(snap):
    if snap.users == 0:
        bpy.data.meshes.remove(snap)
