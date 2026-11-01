# usage: blender -b -P make_hoodie_pen_holder.py -- --name DAVID --number 22 [--out DIR] [--no-render] [--no-slice]
"""Team hoodie pen holder: a pen cup shaped like a hoodie, about 74 mm wide and 100 mm
tall. The hood is the opening; walls 2.2 mm, solid 4 mm base. The name over the
number is raised 1 mm on the chest in a second colour.

Built to print upright with NO supports: every downward-facing surface is held at
45 degrees or less from vertical (the script measures it), the sleeves are merged into
the body, the raised letters have 45-degree undersides, and the pocket, ribbing and
hood edge are V-grooves rather than ledges.
"""
import os, sys, json, math, time, argparse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "lib"))
import itp_lib as L
import manifold3d as m3d
from shapely.geometry import box, Point
from shapely.ops import unary_union
from shapely import affinity

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--name", default="DAVID")
ap.add_argument("--number", default="22")
ap.add_argument("--body-color", default="#6E1423")
ap.add_argument("--text-color", default="#D9A93B")
ap.add_argument("--out", default=HERE)
ap.add_argument("--no-render", action="store_true")
ap.add_argument("--no-slice", action="store_true")
A = ap.parse_args(argv)
T0 = time.time()  # order_print refuses STLs older than this run
import order_print
order_print.refuse_product_folder(HERE, A.out, all(getattr(A, k) == ap.get_default(k)
                                                   for k in ("name", "number", "body_color", "text_color")))

SLUG = "hoodie_pen_holder"
WALL = 2.2
FLOOR = 4.0
D = 40.0             # torso depth (front face flat and vertical up to the shoulders)
YF = -D / 2          # front face plane
RAISE = 1.0          # letter relief
checks = {"name": A.name, "number": A.number}


def rr(w, d, r):
    return box(-w / 2 + r, -d / 2 + r, w / 2 - r, d / 2 - r).buffer(r, quad_segs=16)


def slab(w, d, r, z, inset=0.0, t=0.01):
    return L.extrude(rr(w - 2 * inset, d - 2 * inset, max(0.5, r - inset)), z, z + t)


# torso profile: (z, width, depth, corner radius) - widths only shrink upward at <= 45 deg
PROFILE = [(0, 52, D, 9), (60, 52, D, 9), (72, 48, D, 10), (86, 42, 36, 14)]
HOOD = [(86, 42, 36, 14), (101, 45, 38, 17)]


def hull_profile(prof, inset=0.0):
    parts = []
    for (z0, w0, d0, r0), (z1, w1, d1, r1) in zip(prof, prof[1:]):
        parts.append(m3d.Manifold.batch_hull([slab(w0, d0, r0, z0, inset), slab(w1, d1, r1, z1 - 0.01, inset)]))
    return L.union(parts)


torso = hull_profile(PROFILE)
hood = hull_profile(HOOD)
outer = torso + hood

# sleeves: merged into the body. Shoulder -> elbow -> cuff, standing on the bed.
def sph(x, y, z, r):
    return m3d.Manifold.sphere(r, 48).translate((x, y, z))


def cyl(x, y, z0, z1, r):
    return m3d.Manifold.cylinder(z1 - z0, r, r, 48).translate((x, y, z0))


sleeves = []
for sx in (-1, 1):
    up = m3d.Manifold.batch_hull([sph(sx * 24.5, 0, 66.5, 8.4), sph(sx * 29.5, 0, 40.0, 7.8)])
    low = m3d.Manifold.batch_hull([sph(sx * 29.5, 0, 40.0, 7.8), cyl(sx * 30.0, 0, 0.0, 9.0, 7.4)])
    sleeves += [up, low]
# shoulders: one convex yoke over both sleeve tops, so the arms hang FROM the shoulders
# instead of standing beside the body like posts
yoke = m3d.Manifold.batch_hull([slab(52, D, 9, 56.0), slab(46, D, 12, 76.0), slab(42, 36, 14, 85.5),
                                sph(-24.5, 0, 66.5, 8.4), sph(24.5, 0, 66.5, 8.4)])
outer = L.union([outer, yoke] + sleeves)

# hood top cut: lower at the front (88) than the back (101), then a V-neck notch in front
cutter = m3d.Manifold.cube((200, 200, 100), True).translate((0, 0, 50))
ang = math.degrees(math.atan2(101 - 89, D))
cutter = cutter.rotate((ang, 0, 0)).translate((0, 0, 89 + (101 - 89) / 2))
outer = outer - cutter

cavity = hull_profile([(FLOOR, 52, D, 9), (60, 52, D, 9), (72, 48, D, 10), (86, 42, 36, 14), (101, 45, 38, 17), (130, 45, 38, 17)], inset=WALL)
body = outer - cavity

V = m3d.CrossSection([[(-0.6, 79.0), (0.6, 79.0), (11.0, 101.0), (-11.0, 101.0)]])
vcut = m3d.Manifold.extrude(V, 12).rotate((90, 0, 0)).translate((0, YF + 6, 0))
body = body - vcut

# V-groove helper on a face: the hull of two octahedra, so every face of the groove,
# its ends included, sits at 45 degrees or steeper (no flat ceilings to print)
def vgroove(p, q, y_face, size=1.2, sign=-1):
    (x0, z0), (x1, z1) = p, q
    r = size / math.sqrt(2)
    octa = m3d.Manifold.sphere(r, 4).scale((1, 1, 1.15))  # taller than deep: faces steeper than 45
    return m3d.Manifold.batch_hull([octa.translate((x0, y_face, z0)), octa.translate((x1, y_face, z1))])


grooves = []
# kangaroo pocket (front), a trapezoid
pk = [(-19, 31), (19, 31), (23, 13), (-23, 13)]
for i in range(4):
    grooves.append(vgroove(pk[i], pk[(i + 1) % 4], YF))
# waistband top line, front and back, and ribs
grooves.append(vgroove((-22, 10.5), (22, 10.5), YF))
grooves.append(vgroove((-22, 10.5), (22, 10.5), -YF))
for x in [i * 3.2 for i in range(-6, 7)]:
    grooves.append(vgroove((x, 0.6), (x, 9.6), YF, size=0.9))
    grooves.append(vgroove((x, 0.6), (x, 9.6), -YF, size=0.9))
grooves_m = L.union(grooves)
body = body - grooves_m

# drawstrings: raised cords from the neck down the chest, cone tips (45 deg) at the bottom
for sx in (-1, 1):
    top = (sx * 6.0, YF + 2.0, 86.0)
    mid = (sx * 6.6, YF + 0.2, 66.0)
    tip = (sx * 6.6, YF + 0.2, 63.6)
    cord = m3d.Manifold.batch_hull([sph(*top, 1.1), sph(*mid, 1.1)]) + \
        m3d.Manifold.batch_hull([sph(*mid, 1.1), sph(*tip, 0.05)])
    aglet = m3d.Manifold.batch_hull([sph(sx * 6.6, YF + 0.2, 66.5, 1.5), sph(sx * 6.6, YF + 0.2, 64.4, 0.1)])
    body = body + cord + aglet
body = body - cavity  # cords never poke into the cup

# --------------------------------------------------- raised name and number --
def relief(shape, depth=RAISE):
    """Raised letters on the front face with a true 45-degree underside: the letter
    plate at the front, Minkowski-summed with a wedge that lets it slide down by as
    much as it steps back toward the wall. Nothing hangs flat."""
    t = 0.001
    plate = L.extrude(shape, depth - t, depth)
    e = 0.002
    back = depth - t
    drop = back * 1.1   # a touch steeper than 45 degrees
    wedge = m3d.Manifold.hull_points([(sx, 0, 0) for sx in (-e, e)] + [(sx, 0, -back) for sx in (-e, e)] +
                                     [(sx, -drop, -back) for sx in (-e, e)])
    m = plate.minkowski_sum(wedge).simplify(0.003)
    return m.rotate((90, 0, 0)).translate((0, YF, 0))


name = L.text_shape(A.name.upper(), "Graduate-Regular.ttf", cap_mm=8.0)
name, s1 = L.fit_center(name, 0, 55.5, max_w=33.0, max_h=8.0)
num = L.text_shape(A.number, "Graduate-Regular.ttf", cap_mm=16.0)
num, s2 = L.fit_center(num, 0, 41.5, max_w=30.0, max_h=15.0)
text2d = unary_union([name, num])
text = relief(text2d)
checks["name_cap_mm"] = round(8.0 * s1, 2)
checks["number_cap_mm"] = round(16.0 * s2, 2)
checks["text_stroke_thinner_than_0.8mm_mm2"] = [round(x, 3) for x in L.thin_report(text2d, 0.8)]
checks["text_raise_mm"] = RAISE

# -------------------------------------------------------------- checks ----
bb = body.bounding_box()
checks["bbox_mm"] = [round(bb[3] - bb[0], 1), round(bb[4] - bb[1], 1), round(bb[5] - bb[2], 1)]
checks["wall_mm"] = WALL
checks["floor_mm"] = FLOOR
checks["cup_inside_mm"] = {"bottom": [52 - 2 * WALL, D - 2 * WALL], "opening_at_shoulders": [40 - 2 * WALL, 35 - 2 * WALL]}
oh_body = L.overhang_report(body)
oh_text = L.overhang_report(text)
checks["overhang_over_45deg_body"] = {"area_mm2": round(oh_body[0], 2), "worst_deg_from_vertical": round(oh_body[1], 1), "lowest_z": oh_body[2]}
checks["overhang_over_45deg_text"] = {"area_mm2": round(oh_text[0], 2), "worst_deg_from_vertical": round(oh_text[1], 1)}
checks["part_overlap_mm3"] = round((body ^ text).volume(), 4)
checks["volume_mm3"] = {"body": round(body.volume(), 1), "text": round(text.volume(), 1)}

os.makedirs(A.out, exist_ok=True)

# ---------------------------------------- glue-on version (print check, 2026-11-01) --
# Two colours on an upright wall cost ~127 AMS swaps, 5.5 h and 104 g (60 g of it purge) on
# the A1. So the print file's default is the body in one colour with a letter-shaped pocket on
# the chest, plus the letters printed flat in gold that drop into it: the pocket places them,
# one drop of CA glue holds them. Pocket 0.6 mm deep (the 2.2 mm wall keeps 1.6 mm),
# 0.15 mm clearance per side; letters 1.6 mm thick, so they stand 1.0 mm proud like the relief.
POCKET, GLUE_CLR = 0.6, 0.15
_pk2d = text2d.buffer(GLUE_CLR, join_style=2)
_pocket = L.extrude(_pk2d, -POCKET, 0.05).rotate((90, 0, 0)).translate((0, YF, 0))  # rotate maps z to -y: into the wall
body_glue = body - _pocket
letters_glue = L.extrude(text2d, 0, POCKET + RAISE)
checks["glue_version"] = {"pocket_depth_mm": POCKET, "clearance_mm": GLUE_CLR, "letters_thick_mm": POCKET + RAISE,
                          "wall_left_behind_pocket_mm": round(WALL - POCKET, 2)}
_prod = os.path.join(A.out, "production")
os.makedirs(_prod, exist_ok=True)
L.write_stl(body_glue, os.path.join(_prod, "body_glue_pocket.stl"))
L.write_stl(letters_glue, os.path.join(_prod, "letters_glue_flat.stl"))

stls = []
for key, m, sl in (("body", body, 1), ("text", text, 2)):
    fn = os.path.join(A.out, f"{SLUG}_{key}.stl")
    L.write_stl(m, fn)
    stls.append({"stl": fn, "slot": sl})

import bpy
L.reset_scene()
ob_b = L.bl_mesh("Hoodie", body, A.body_color, rough=0.6)
ob_t = L.bl_mesh("NameNumber", text, A.text_color, rough=0.45)
checks["print3d"] = {"body": L.print3d_check(ob_b), "text": L.print3d_check(ob_t)}
print("CHECKS", json.dumps(checks, indent=1))

if not A.no_slice:
    # The print file comes from the same path as the product's PRINT.3mf: print_spec.json (body with the
    # letter pocket, the gold letters flat, the optional one-piece plate) re-pointed at this run's STLs,
    # through print_check.py, then held up against the product's file (task e912b835). Never slice an
    # order through itp_slice.py: Cool Plate (35 C bed, the first layer lifts on our PEI), 0.20 mm,
    # 2 walls, one two-colour plate, no N2S stamp (the A1 refuses it).
    nm, no = A.name.upper(), A.number
    order_print.make_print(HERE, A.out, colors=[A.body_color, A.text_color], started=T0,
                           rename={"DAVID 22": f"{nm} {no}", "DAVID": nm})

# desk scene with a few pens in the cup
desk = L.add_plane("Desk", 2.0, (0, 0, 0), color=(0.16, 0.08, 0.035), rough=0.5)
wall = L.add_plane("Wall", 2.0, (0, 0.5, 0.5), rot=(math.radians(90), 0, 0), color=(0.55, 0.52, 0.48), rough=0.9)
from mathutils import Vector, Euler
for i, (px, py, tilt, col) in enumerate([(-8, 4, (-9, -12), (0.02, 0.02, 0.02)), (-3, 7, (7, -5), (0.62, 0.62, 0.64)),
                                         (5, 4, (-5, 10), (0.03, 0.03, 0.03)), (10, 1, (8, 13), (0.55, 0.55, 0.57)),
                                         (1, -2, (-10, 3), (0.08, 0.08, 0.09))]):
    rot = Euler((math.radians(tilt[0]), math.radians(tilt[1]), 0))
    axis = Vector((0, 0, 1))
    axis.rotate(rot)
    bottom = Vector((px / 1000, py / 1000, (FLOOR + 1.5) / 1000))
    centre = bottom + axis * 0.07
    bpy.ops.mesh.primitive_cylinder_add(radius=0.0042, depth=0.14, location=centre, rotation=rot)
    pen = bpy.context.active_object
    m = bpy.data.materials.new(f"pen{i}")
    m.use_nodes = True
    m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*col, 1)
    m.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.3
    m.node_tree.nodes["Principled BSDF"].inputs["Metallic"].default_value = 0.5 if col[0] > 0.3 else 0.0
    pen.data.materials.append(m)
L.add_world((0.6, 0.62, 0.66), 0.06)
key = L.add_light("AREA", (-0.3, -0.25, 0.3), 9, size=0.5, color=(1.0, 0.95, 0.88), name="Window")
L.look_at(key, (0, 0, 0.05))
rim = L.add_light("AREA", (0.25, 0.2, 0.25), 3, size=0.3, color=(1.0, 0.85, 0.7), name="Rim")
L.look_at(rim, (0, 0, 0.05))

if not A.no_render:
    L.setup_render(1600, 1200, samples=192)
    L.add_camera((-0.06, -0.30, 0.13), (0.0, 0.0, 0.052), lens=55, dof_target=(0, -0.02, 0.05), fstop=4.0)
    L.render(os.path.join(A.out, "render.png"))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(A.out, f"{SLUG}.blend"))
json.dump(checks, open(os.path.join(A.out, "checks.json"), "w"), indent=1)
print("DONE", A.out)
