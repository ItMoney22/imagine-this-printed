# usage: blender -b -P make_dino_ornament.py -- --name NOAH [--out DIR] [--no-render] [--no-slice] [--preview2d]
"""Kid name ornament: a smiling T-rex in a Santa hat with the child's name across its
belly. Flat relief, 85 mm tall, 4.6 mm thick, hang hole through the hat.

Colour is STACKED, not side by side: the whole silhouette is one green slab, and
the hat, the white trim and the name, and the light-green belly sit on top of it.
So the four colours only share the top 1.4 mm, and the AMS swaps a handful of times
instead of on every layer. The back is plain green.
The T-rex is our own drawing, built from ellipses and strokes in this script.
"""
import os, sys, json, math, time, argparse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "lib"))
import itp_lib as L
import manifold3d as m3d
from shapely.geometry import Point, Polygon, LineString, box
from shapely.ops import unary_union
from shapely import affinity

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--name", default="NOAH")
ap.add_argument("--out", default=HERE)
ap.add_argument("--no-render", action="store_true")
ap.add_argument("--no-slice", action="store_true")
ap.add_argument("--preview2d", action="store_true")
A = ap.parse_args(argv)
T0 = time.time()  # order_print refuses STLs older than this run
import order_print
order_print.refuse_product_folder(HERE, A.out, all(getattr(A, k) == ap.get_default(k) for k in ("name",)))

SLUG = "dino_ornament"
HEIGHT = 85.0
T_BASE = 3.2        # green slab
T_BELLY = 3.8       # light-green belly top
T_HAT = 4.4         # red hat top
T_TOP = 4.6         # white trim, pompom and name top
ENGRAVE = 0.8
COL = {"green": "#2E9E4A", "light": "#8FD16A", "red": "#D7262E", "white": "#F4F4F0"}
checks = {"name": A.name}


def E(cx, cy, rx, ry, rot=0):
    e = affinity.scale(Point(0, 0).buffer(1, quad_segs=32), rx, ry)
    return affinity.translate(affinity.rotate(e, rot, origin=(0, 0)), cx, cy)


def S(pts, w):
    return LineString(pts).buffer(w / 2, quad_segs=10)


def taper(pts, r0, r1, n=40):
    """A stroke along pts whose radius runs from r0 to r1 (a tail)."""
    line = LineString(pts)
    out = []
    for i in range(n + 1):
        t = i / n
        p = line.interpolate(t, normalized=True)
        out.append(Point(p.x, p.y).buffer(r0 + (r1 - r0) * t, quad_segs=10))
    return unary_union([unary_union(out[i:i + 2]).convex_hull for i in range(n)])


# ------------------------------------------------------------- drawing ----
head = unary_union([E(-6, 52, 15.5, 12.5), E(-17.5, 47.5, 11.0, 8.6, -6), E(-12, 42.5, 12.5, 6.0, -4)])
body = unary_union([E(3, 27, 15.5, 19.5, -12), E(-3, 38, 9.5, 9.0)])
tail = taper([(12, 20), (24, 12.5), (33, 10), (39.5, 14.5)], 8.5, 1.6)
leg_f = unary_union([E(-5.5, 9.5, 7.2, 9.0, 8), E(-8.5, 2.6, 8.8, 2.9)])
leg_b = unary_union([E(11.5, 10.5, 7.6, 9.2, -10), E(14.0, 2.7, 8.6, 2.9)])
arm_f = S([(-11.5, 31.5), (-18.0, 29.5), (-19.5, 32.0)], 4.2)
arm_b = S([(-6.0, 29.5), (-12.5, 25.5), (-13.0, 28.0)], 3.6)
core = unary_union([head, body, tail, leg_f, leg_b, arm_f, arm_b])
# spikes along the back: aim points just outside the back, each spike rooted on the
# nearest point of the real outline and pointing straight out of it
aims = [(10.5, 58.0), (13.0, 49.0), (16.5, 40.5), (19.5, 31.0), (23.5, 22.5), (29.5, 17.0), (35.5, 16.2)]
spikes = []
edge = core.exterior
for i, (ax, ay) in enumerate(aims):
    q = edge.interpolate(edge.project(Point(ax, ay)))
    nx, ny = ax - q.x, ay - q.y
    ln = math.hypot(nx, ny) or 1.0
    if not core.contains(Point(ax, ay)):
        nx, ny = nx / ln, ny / ln
    else:
        nx, ny = -nx / ln, -ny / ln
    tx, ty = -ny, nx
    size = 3.6 if i < 4 else 2.7
    bx, by = q.x - nx * 0.8, q.y - ny * 0.8
    spikes.append(Polygon([(bx - tx * size * 0.8, by - ty * size * 0.8), (q.x + nx * size, q.y + ny * size),
                           (bx + tx * size * 0.8, by + ty * size * 0.8)]).buffer(0.45, quad_segs=6))
dino = unary_union([head, body, tail, leg_f, leg_b, arm_f, arm_b] + spikes)
dino = unary_union([dino, unary_union(spikes)])

# Santa hat: white brim across the brow, red cap drooping to the right, white pompom
brim = S([(-21.0, 58.5), (-9.0, 62.5), (4.5, 63.0)], 6.0)
cap = Polygon([(-19.0, 60.5), (-12.0, 69.5), (-2.0, 74.0), (8.0, 74.5), (16.5, 71.0), (23.0, 64.5),
               (25.5, 57.5), (22.5, 57.0), (17.5, 62.5), (9.0, 63.5), (4.5, 63.0), (-9.0, 62.0)]).buffer(1.2, quad_segs=8)
pompom = Point(25.0, 56.0).buffer(4.6, quad_segs=24)
hat_all = unary_union([brim, cap, pompom])
hole = Point(-1.0, 69.5).buffer(1.9, quad_segs=24)

# face: engraved eye ring with a white highlight, smile, nostril
eye = Point(-8.5, 52.5).buffer(2.4, quad_segs=24)
eye_hi = Point(-9.2, 53.3).buffer(0.75, quad_segs=12)
smile = S([(-26.0, 46.0), (-22.0, 43.6), (-15.0, 42.6), (-8.5, 43.8), (-6.0, 45.6)], 1.1)
nostril = E(-24.5, 50.5, 1.0, 0.7, 20)
engrave = unary_union([eye, smile, nostril])  # the eye is a pocket; its white highlight sits inside it

belly = E(-1.5, 24.0, 10.5, 15.0, -10).intersection(body.buffer(-1.5))

outline = unary_union([dino, hat_all]).difference(hole)
# scale everything so the ornament is HEIGHT tall
minx, miny, maxx, maxy = outline.bounds
k = HEIGHT / (maxy - miny)


def K(g):
    return affinity.scale(affinity.translate(g, -(minx + maxx) / 2, -miny), k, k, origin=(0, 0))


outline, hat_all, brim, pompom, cap, engrave, eye_hi, belly, hole = map(
    K, [outline, hat_all, brim, pompom, cap, engrave, eye_hi, belly, hole])

# the name, as big as the belly band allows
nm = L.text_shape(A.name.upper(), "Fredoka.ttf", cap_mm=10, wght=700)
bx = belly.bounds
name_w = min(32.0, (bx[2] - bx[0]) * 1.35)
nm, s_nm = L.fit_center(nm, (bx[0] + bx[2]) / 2 + 4.0, (bx[1] + bx[3]) / 2 - 1.0, max_w=name_w, max_h=12.0)
_a = nm.area
nm = nm.intersection(outline.buffer(-1.2))
checks["name_clipped_mm2"] = round(_a - nm.area, 3)
white = unary_union([brim.difference(pompom), pompom, nm]).intersection(outline)
red = cap.difference(unary_union([brim, pompom])).intersection(outline).difference(hole).difference(white.buffer(0.02))
light = belly.difference(nm.buffer(0.3))

thin_name = L.thin_report(nm, 0.8)
checks["name_cap_height_mm"] = round(10 * s_nm, 2)
checks["name_stroke_thinner_than_0.8mm_mm2"] = [round(x, 3) for x in thin_name]
checks["outline_thinner_than_1.2mm_mm2"] = [round(x, 3) for x in L.thin_report(outline, 1.2)]
checks["bbox_mm"] = [round(x, 1) for x in outline.bounds]
checks["pieces_outline"] = len(L.components(outline))

if A.preview2d:
    os.makedirs(A.out, exist_ok=True)

    def sv(g, c):
        return "" if g.is_empty else g.svg(scale_factor=0.05, fill_color=c, opacity=1.0)
    b = outline.bounds
    open(os.path.join(A.out, "_preview2d.svg"), "w").write(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{b[0]-5} {-b[3]-5} {b[2]-b[0]+10} {b[3]-b[1]+10}" width="1000" height="{int(1000*(b[3]-b[1]+10)/(b[2]-b[0]+10))}">'
        f'<rect x="{b[0]-5}" y="{-b[3]-5}" width="{b[2]-b[0]+10}" height="{b[3]-b[1]+10}" fill="#333"/>'
        f'<g transform="scale(1,-1)">{sv(outline, COL["green"])}{sv(light, COL["light"])}{sv(red, COL["red"])}'
        f'{sv(white, COL["white"])}{sv(engrave.intersection(outline), "#145a25")}</g></svg>')
    print(json.dumps(checks, indent=1))
    sys.exit(0)

# --------------------------------------------------------------- solids ---
green = L.extrude(outline, 0, T_BASE) - L.extrude(engrave.intersection(outline.buffer(-0.8)), T_BASE - ENGRAVE, T_BASE + 1)
light_m = L.extrude(light, T_BASE, T_BELLY)
red_m = L.extrude(red, T_BASE, T_HAT)
white_m = L.union([L.extrude(white, T_BASE, T_TOP),
                   L.extrude(eye_hi.intersection(outline), T_BASE - ENGRAVE, T_BASE - 0.15)])
bodies = {"green": green, "light": light_m, "red": red_m, "white": white_m}
ov = {}
ks = list(bodies)
for i in range(len(ks)):
    for j in range(i + 1, len(ks)):
        ov[f"{ks[i]}&{ks[j]}"] = round((bodies[ks[i]] ^ bodies[ks[j]]).volume(), 4)
checks["part_overlap_mm3"] = ov
checks["thickness_mm"] = T_TOP

os.makedirs(A.out, exist_ok=True)
slots = {"green": 1, "light": 2, "red": 3, "white": 4}
names = {"green": "Green (body)", "light": "Light green (belly)", "red": "Red (hat)", "white": "White (trim, name)"}
stls = []
for key, m in bodies.items():
    fn = os.path.join(A.out, f"{SLUG}_{key}.stl")
    L.write_stl(m, fn)
    stls.append({"stl": fn, "slot": slots[key]})

import bpy
L.reset_scene()
p3 = {}
obs = {}
for key, m in bodies.items():
    ob = L.bl_mesh(key, m, COL[key], rough=0.5)
    p3[key] = L.print3d_check(ob)
    obs[key] = ob
checks["print3d"] = p3
print("CHECKS", json.dumps(checks, indent=1))

if not A.no_slice:
    # The print file comes from the same path as the product's PRINT.3mf: print_spec.json re-pointed at
    # this run's STLs, through print_check.py, then held up against the product's file (task e912b835).
    # Never slice an order through itp_slice.py: Cool Plate (35 C bed, the first layer lifts on our PEI),
    # 0.20 mm, 2 walls, no ironing, no N2S stamp (the A1 refuses it).
    order_print.make_print(HERE, A.out, rename={"NOAH": A.name.upper()}, started=T0)

# hang it: upright, ribbon through the hat hole, tree lights behind
for ob in obs.values():
    ob.rotation_euler = (math.radians(90), 0, 0)
hc = hole.centroid
rib = bpy.data.objects.new("Ribbon", bpy.data.curves.new("Ribbon", "CURVE"))
rib.data.dimensions = "3D"
sp = rib.data.splines.new("POLY")
sp.points.add(1)
sp.points[0].co = (hc.x / 1000, -0.0023, hc.y / 1000, 1)
sp.points[1].co = (hc.x / 1000, -0.0023, 0.20, 1)
rib.data.extrude = 0.0035
rib.data.bevel_depth = 0.0
mr = bpy.data.materials.new("ribbon")
mr.use_nodes = True
mr.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*L.hex_lin("#C8102E"), 1)
mr.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.35
rib.data.materials.append(mr)
bpy.context.scene.collection.objects.link(rib)
L.add_world((0.02, 0.025, 0.02), 1.0)
L.add_bokeh(45, (0.0, 0.75, 0.05), (0.45, 0.05), (-0.25, 0.35), radius=0.007, strength=12)
back = L.add_plane("Tree", 4.0, (0, 0.85, 0), rot=(math.radians(90), 0, 0), color=(0.02, 0.07, 0.03), rough=0.9)
key = L.add_light("AREA", (-0.18, -0.25, 0.22), 5, size=0.35, color=(1.0, 0.9, 0.78), name="Key")
L.look_at(key, (0, 0, 0.04))
rim = L.add_light("AREA", (0.2, 0.15, 0.15), 2, size=0.2, color=(1.0, 0.8, 0.55), name="Rim")
L.look_at(rim, (0, 0, 0.04))

if not A.no_render:
    L.setup_render(1600, 1200, samples=192)
    L.add_camera((-0.045, -0.24, 0.07), (0.0, 0.0, 0.045), lens=60, dof_target=(0, 0, 0.045), fstop=2.8)
    L.render(os.path.join(A.out, "render.png"))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(A.out, f"{SLUG}.blend"))
json.dump(checks, open(os.path.join(A.out, "checks.json"), "w"), indent=1)
print("DONE", A.out)
