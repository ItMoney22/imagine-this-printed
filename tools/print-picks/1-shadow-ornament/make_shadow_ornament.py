# usage: blender -b -P make_shadow_ornament.py -- --name "The Trinidads" [--top "The"] [--out DIR] [--no-render] [--no-slice]
"""Shadow ornament: an 80 mm disc with the sleigh-and-reindeer and the family name
cut THROUGH it as a stencil. Hung in front of a tree light it throws the picture,
lit, onto the wall. One colour, white PLA, prints flat.

Every solid piece is tied to the frame: letter counters (the insides of a, d, e, o)
and anything else the cut-outs enclose get a 1.2 mm stencil bridge to the nearest
solid, found automatically, so any name a customer types is printable.
"""
import os, sys, json, math, time, argparse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "lib"))
import itp_lib as L
from shapely.geometry import Point, Polygon, LineString, box
from shapely.ops import unary_union
from shapely import affinity

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--name", default="The Trinidads", help="full name; if it starts with 'The ' that word goes on its own line")
ap.add_argument("--top", default=None, help="override the small top line (default: 'The' when the name starts with it)")
ap.add_argument("--out", default=HERE)
ap.add_argument("--no-render", action="store_true")
ap.add_argument("--no-slice", action="store_true")
A = ap.parse_args(argv)
T0 = time.time()  # order_print refuses STLs older than this run
import order_print
order_print.refuse_product_folder(HERE, A.out, all(getattr(A, k) == ap.get_default(k) for k in ("name", "top")))

SLUG = "shadow_ornament"
R = 40.0            # disc radius (80 mm wide)
T = 2.6             # thickness
RIM = 3.0           # solid rim kept around the picture
BRIDGE = 1.2        # stencil bridge width = minimum wall
MIN_CUT = 1.2       # thinnest slit we let light through
MIN_WALL = 1.2
log = []

# ------------------------------------------------------------ the picture --


def stroke(pts, w):
    return LineString(pts).buffer(w / 2, quad_segs=6)


def ellipse(cx, cy, rx, ry, rot=0):
    e = affinity.scale(Point(0, 0).buffer(1, quad_segs=24), rx, ry)
    return affinity.translate(affinity.rotate(e, rot, origin=(0, 0)), cx, cy)


def reindeer(phase=0):
    """A leaping reindeer facing left, drawn from primitives (our own design)."""
    w = 1.35
    body = ellipse(0, 0, 5.6, 2.5, -10)
    neck = stroke([(-3.8, 0.9), (-6.0, 4.4)], 2.6)
    head = ellipse(-7.3, 5.3, 2.1, 1.25, -18)
    snout = ellipse(-9.0, 4.65, 1.1, 0.8, -18)
    ear = stroke([(-6.4, 6.0), (-5.2, 7.0)], 0.9 + 0.5)
    ant = [stroke([(-7.0, 6.2), (-6.6, 8.6), (-5.4, 10.6)], w),
           stroke([(-6.75, 7.9), (-8.3, 9.4)], w),
           stroke([(-6.1, 9.6), (-6.7, 11.4)], w),
           stroke([(-6.4, 6.3), (-5.5, 8.3), (-3.9, 9.8)], w),
           stroke([(-5.1, 8.9), (-4.9, 10.9)], w)]
    a = 1.0 if phase == 0 else -1.0
    legs = [stroke([(-3.4, -1.0), (-6.0, -2.0), (-9.0, -1.2)], 1.45),
            stroke([(-2.4, -1.6), (-3.4, -4.6), (-5.0, -6.4 + 0.3 * a)], 1.45),
            stroke([(3.6, -0.8), (6.4, -1.7), (9.6, -1.0)], 1.5),
            stroke([(3.4, -1.6), (4.4, -4.6), (6.4, -6.2 - 0.3 * a)], 1.5)]
    tail = Polygon([(5.0, 1.0), (7.0, 2.6), (6.1, 0.4)])
    return unary_union([body, neck, head, snout, ear, tail] + ant + legs)


def sleigh():
    """Sleigh with Santa and a toy sack, facing left."""
    runner = stroke([(-1.0, -7.4), (13.5, -7.4), (15.5, -6.8), (16.4, -5.2)], 1.4)
    curl = stroke([(-1.0, -7.4), (-2.8, -6.9), (-3.5, -5.6), (-2.9, -4.6), (-1.9, -4.8)], 1.4)
    struts = [stroke([(2.0, -7.4), (2.0, -3.8)], 1.4), stroke([(11.0, -7.4), (11.0, -3.8)], 1.4)]
    tub = Polygon([(-0.6, -3.9), (14.2, -3.9), (15.6, -2.2), (16.0, 2.6), (14.6, 3.4),
                   (12.6, 1.0), (4.0, 0.8), (1.6, 0.9), (-0.4, 2.2), (-1.8, 1.6), (-1.6, -1.6)])
    santa_body = ellipse(8.2, 2.6, 3.0, 2.8)
    santa_head = Point(8.0, 6.3).buffer(1.6, quad_segs=16)
    hat = Polygon([(6.4, 6.9), (9.6, 7.2), (11.8, 8.9), (12.6, 8.2), (12.9, 8.6), (11.6, 10.0), (8.3, 9.4)])
    pompom = Point(12.9, 8.3).buffer(0.8, quad_segs=12)
    beard = ellipse(6.9, 5.4, 1.2, 1.4)
    arm = stroke([(6.6, 3.6), (4.6, 2.6), (2.6, 3.0)], 1.6)
    sack = unary_union([ellipse(13.0, 3.6, 2.6, 3.2, 12), stroke([(12.4, 6.3), (13.6, 7.6)], 1.2)])
    return unary_union([runner, curl, tub, santa_body, santa_head, hat, pompom, beard, arm, sack] + struts)


def team():
    r1 = reindeer(0)
    r2 = affinity.translate(reindeer(1), 16.5, 0)
    s = affinity.translate(sleigh(), 37.0, 1.4)
    reins = stroke([(-3.0, 1.0), (13.0, 1.2), (30.0, 2.0), (39.5, 4.4)], 0.8 + 0.5)
    g = unary_union([r1, r2, s, reins])
    return g


# ------------------------------------------------------------- the layout --

name = A.name.strip()
top = A.top
if top is None and name.lower().startswith("the "):
    top, name = name[:3], name[4:].strip()

inner_r = R - RIM
pic, _ = L.fit_center(team(), 0, 21.5, max_w=54.0, max_h=15.5)

main = L.text_shape(name, "DancingScript.ttf", cap_mm=12, wght=700)
main = main.buffer(0.12, quad_segs=6)   # thicken hairlines so every slit passes light
# the widest the name can be on its baseline band, inside the circle
main, s_main = L.fit_center(main, 0, -14.0, max_w=62.0, max_h=20.0)
parts = [pic, main]
if top:
    t = L.text_shape(top, "DancingScript.ttf", cap_mm=12, wght=700).buffer(0.12, quad_segs=6)
    t, _ = L.fit_center(t, 0, 3.0, max_w=40.0, max_h=13.0 * s_main + 1)
    parts.append(t)
cut = unary_union(parts)
# never cut into the rim
safe = Point(0, 0).buffer(inner_r, quad_segs=64)
cut = cut.intersection(safe)

disc = Point(0, 0).buffer(R, quad_segs=96)
loop_tab = unary_union([Point(0, R + 3.2).buffer(5.2, quad_segs=32), box(-5.2, R - 2, 5.2, R + 3.2)])
loop_hole = Point(0, R + 3.6).buffer(2.3, quad_segs=24)
outline = unary_union([disc, loop_tab]).difference(loop_hole)

solid = outline.difference(cut)
# minimum wall: any solid narrower than MIN_WALL becomes cut (opening). Slits only
# ever get wider this way, so light still passes; a too-thin counter just opens up.
_before = L.components(solid)
_main0 = max(_before, key=lambda p: p.area)
solid = solid.buffer(-MIN_WALL / 2 - 0.06, quad_segs=8).buffer(MIN_WALL / 2 + 0.06, quad_segs=8).intersection(outline)
# ...except letter counters (the eye of an e, the bowl of an a): losing one makes the
# letter a blob of light. Grow a too-thin counter just enough to reach the min wall.
for isl in _before:
    if isl is _main0 or isl.area < 1.0 or isl.intersects(solid.buffer(-0.01)):
        continue
    lo, hi = 0.0, MIN_WALL
    for _ in range(20):
        mid = (lo + hi) / 2
        if isl.buffer(mid).buffer(-MIN_WALL / 2 - 0.06).is_empty:
            lo = mid
        else:
            hi = mid
    solid = L.unary_union([solid, isl.buffer(hi + 0.02, quad_segs=8)]).intersection(outline)
    log.append(f"counter at ({isl.centroid.x:.1f},{isl.centroid.y:.1f}) grown {hi:.2f} mm to keep it")
cut = outline.difference(solid)
frame = outline.difference(Point(0, 0).buffer(inner_r - 0.01, quad_segs=96))

# islands: solid pieces that the stencil cut away from the frame -> bridge them back
parts_ = L.components(solid)
main_piece = max(parts_, key=lambda p: p.area)
islands = [p for p in parts_ if p is not main_piece]
bars = []
for isl in sorted(islands, key=lambda p: -p.area):
    if isl.area < 0.4:
        # a speck too small to print on its own: fill it instead (it would be a hole in a counter)
        log.append(f"speck {isl.area:.2f} mm2 removed")
        continue
    a, b = L.nearest_points(isl, main_piece)
    bar = L.bridge((a.x, a.y), (b.x, b.y), BRIDGE, overlap=0.5)
    bars.append(bar)
    log.append(f"bridge {a.distance(b):.2f} mm long for island {isl.area:.1f} mm2 at ({isl.centroid.x:.1f},{isl.centroid.y:.1f})")
solid = unary_union([main_piece] + [i for i in islands if i.area >= 0.4] + bars).intersection(outline)
# recheck: one piece
pieces = L.components(solid)
assert len(pieces) == 1, f"still {len(pieces)} pieces after bridging"

final_cut = outline.difference(solid)
thin_wall = L.thin_report(solid, MIN_WALL)
thin_cut = L.thin_report(final_cut, MIN_CUT * 0.8)
checks = {
    "pieces": len(pieces), "islands_bridged": len(bars), "bridge_log": log,
    "min_wall_mm": MIN_WALL, "solid_thinner_than_min_wall_mm2": [round(x, 2) for x in thin_wall],
    "slits_thinner_than_0.96mm_mm2": [round(x, 2) for x in thin_cut],
    "bbox_mm": [round(x, 2) for x in solid.bounds], "thickness_mm": T,
}

body = L.extrude(solid, 0, T)
os.makedirs(A.out, exist_ok=True)
_tw = solid.difference(solid.buffer(-MIN_WALL / 2, quad_segs=8).buffer(MIN_WALL / 2 + 1e-3, quad_segs=8))
_tc = final_cut.difference(final_cut.buffer(-MIN_CUT * 0.4, quad_segs=8).buffer(MIN_CUT * 0.4 + 1e-3, quad_segs=8))
def _svg(g, c):
    return "" if g.is_empty else g.svg(scale_factor=0.04, fill_color=c, opacity=1.0)
open(os.path.join(A.out, "_preview2d.svg"), "w").write(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-45 -50 90 100" width="1800" height="2000">'
    '<rect x="-45" y="-50" width="90" height="100" fill="#202020"/>'
    f'<g transform="scale(1,-1)">{_svg(solid, "#e8e4da")}{_svg(unary_union(bars) if bars else Polygon(), "#22aa44")}'
    f'{_svg(_tw, "#ff2020")}{_svg(_tc, "#2060ff")}</g></svg>')
stl = os.path.join(A.out, f"{SLUG}.stl")
L.write_stl(body, stl)
checks["volume_mm3"] = round(body.volume(), 1)
checks["manifold_genus"] = body.genus()

# ------------------------------------------------------------- blender ----
import bpy
L.reset_scene()
ob = L.bl_mesh("ShadowOrnament", body, "#F2EFE6", rough=0.55)
checks["print3d"] = L.print3d_check(ob)
print("CHECKS", json.dumps(checks, indent=1))

if not A.no_slice:
    # The print file comes from the same path as the product's PRINT.3mf: print_spec.json re-pointed at
    # this run's STL, through print_check.py, then held up against the product's file (task e912b835).
    # Never slice an order through itp_slice.py: Cool Plate (35 C bed, the first layer lifts on our PEI),
    # 0.20 mm, 2 walls, no ironing, no N2S stamp (the A1 refuses it).
    order_print.make_print(HERE, A.out, rename={"The Trinidads": A.name.strip()}, started=T0)

# scene: ornament hanging upright, a warm wall behind it, a point "tree light" in front
ob.rotation_euler = (math.radians(90), 0, 0)
ob.location = (0, 0.002 * 0 + T / 2000, 0)  # flat side faces -y (toward camera/light)
wall = L.add_plane("Wall", 2.0, (0, 0.16, 0), rot=(math.radians(90), 0, 0), color=(0.62, 0.5, 0.36), rough=0.9)
L.add_world((0.012, 0.009, 0.006), 1.0)
string = bpy.data.objects.new("Twine", bpy.data.curves.new("Twine", "CURVE"))
string.data.dimensions = "3D"
sp = string.data.splines.new("POLY")
sp.points.add(1)
sp.points[0].co = (0, 0, (R + 3.6) / 1000, 1)
sp.points[1].co = (0, 0, 0.25, 1)
string.data.bevel_depth = 0.0006
mt = bpy.data.materials.new("twine")
mt.use_nodes = True
mt.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.45, 0.32, 0.18, 1)
string.data.materials.append(mt)
bpy.context.scene.collection.objects.link(string)
bulb = L.add_light("POINT", (0.0, -0.11, 0.0), 6.0, size=0.0015, color=(1.0, 0.78, 0.5), name="TreeLight")
fill = L.add_light("AREA", (-0.35, -0.35, 0.25), 6.0, size=0.6, color=(1.0, 0.85, 0.7), name="Fill")
L.look_at(fill, (0, 0, 0))

blend = os.path.join(A.out, f"{SLUG}.blend")
if not A.no_render:
    L.setup_render(1600, 1600, samples=192)
    # product shot: three-quarter view, ornament in front, its shadow on the wall
    # warm fairy lights far behind and to the left, thrown out of focus like the concept's tree
    L.add_bokeh(26, (-0.55, 0.05, 0), (0.18, 0.06), (-0.20, 0.22), radius=0.007, strength=40)
    wall.location.x = 0.12  # the wall only on the right half, the lights on the left
    wall.scale = (0.5, 1, 1)
    cam = L.add_camera((-0.105, -0.205, 0.02), (0.02, 0.05, 0.004), lens=58, dof_target=(0, 0, 0), fstop=3.2)
    L.render(os.path.join(A.out, "render.png"))
    # shadow proof: the fill off, only the tree light; camera looks at the wall past the ornament
    fill.hide_render = True
    bpy.context.scene.world.node_tree.nodes["Background"].inputs[1].default_value = 0.4
    wall.location.x = 0.0
    wall.scale = (1, 1, 1)
    for o in bpy.data.objects:
        if o.name.startswith("Sphere"):
            o.hide_render = True
    cam.location = (0.16, -0.12, 0.0)
    L.look_at(cam, (0.0, 0.16, 0.0))
    cam.data.dof.use_dof = False
    cam.data.lens = 32
    L.render(os.path.join(A.out, "shadow.png"))
    fill.hide_render = False
bpy.ops.wm.save_as_mainfile(filepath=blend)
json.dump(checks, open(os.path.join(A.out, "checks.json"), "w"), indent=1)
print("DONE", A.out)
