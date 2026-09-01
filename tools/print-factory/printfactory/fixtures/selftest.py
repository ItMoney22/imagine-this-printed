"""A trivial cube fixture used only to prove the runner end-to-end.
Kept separate so no production fixture carries test-only branches."""
from printfactory.fixtures.base import Fixture, FixtureError, register

@register("_selftest")
class SelfTestCube(Fixture):
    def validate(self, params: dict) -> dict:
        size = float(params.get("size_mm", 20.0))
        if size <= 0:
            raise FixtureError(f"size_mm must be positive, got {size}")
        return {"size_mm": size}

    def build(self, params: dict, ctx):
        import bpy
        bpy.ops.mesh.primitive_cube_add(size=params["size_mm"])
        return bpy.context.active_object
