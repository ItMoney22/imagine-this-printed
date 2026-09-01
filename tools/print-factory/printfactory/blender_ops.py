"""Blender-only helpers. Never imported by tests - `import bpy` fails outside."""
import bpy, bmesh
from mathutils import Vector, Matrix

from printfactory.shellprep import ShellError, normalise_plan

def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def voxel_remesh(obj, voxel_mm: float):
    """Guarantees a manifold solid. Non-optional before any boolean - generated
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
