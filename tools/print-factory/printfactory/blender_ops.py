"""Blender-only helpers. Never imported by tests - `import bpy` fails outside."""
import bpy, bmesh
from mathutils import Vector

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

def bbox_mm(obj) -> dict:
    cs = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    xs = [c.x for c in cs]; ys = [c.y for c in cs]; zs = [c.z for c in cs]
    return {"x": max(xs)-min(xs), "y": max(ys)-min(ys), "z": max(zs)-min(zs)}

def export_stl(obj, filepath: str):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.wm.stl_export(filepath=filepath, export_selected_objects=True)
