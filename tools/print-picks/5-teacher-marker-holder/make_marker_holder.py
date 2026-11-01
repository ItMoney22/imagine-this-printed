# usage: blender -b -P make_marker_holder.py -- --name "Mrs. Johnson" [--marker-d 18.0] [--magnet 20x3] [--out DIR] [--no-render] [--no-slice]
"""Teacher marker holder: a 236 mm yellow pencil with a flat back that sticks to a
whiteboard on 4 round magnets and holds 4 dry-erase markers upright in pockets.
Pink eraser, grey ferrule, wood-tone cone with a black tip, the name raised in black
with a small red apple (green leaf).

The pencil is three pieces joined by 45-degree diamond pegs, so every plate stays
inside the AMS lite's 4 colours and its colours STACK by height (few swaps):
  A  body, printed flat on its back: yellow, then black name + stem, red apple, green leaf on top
  B  eraser + ferrule, printed standing: pink below, grey above (one swap)
  C  cone + tip, printed standing: wood below, black tip on top (one swap)
The marker pockets are truncated teardrops (they print lying down with no supports);
the magnet pockets open onto the bed.
"""
import os, sys, json, math, time, argparse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "lib"))
import itp_lib as L
import manifold3d as m3d
from shapely.geometry import Point, Polygon, box, LineString
from shapely.ops import unary_union
from shapely import affinity

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--name", default="Mrs. Johnson")
ap.add_argument("--upper", default="1", help="1 = set the name in capitals like the concept")
ap.add_argument("--marker-d", type=float, default=18.0, help="marker diameter with the cap on, mm (Expo ~16-18)")
ap.add_argument("--magnet", default="20x3", help="round magnet diameter x thickness, mm")
ap.add_argument("--out", default=HERE)
ap.add_argument("--no-render", action="store_true")
ap.add_argument("--no-slice", action="store_true")
A = ap.parse_args(argv)
T0 = time.time()  # order_print refuses STLs older than this run
import order_print
order_print.refuse_product_folder(HERE, A.out, all(getattr(A, k) == ap.get_default(k)
                                                   for k in ("name", "upper", "marker_d", "magnet")))

SLUG = "marker_holder"
COL = {"yellow": "#F7C600", "black": "#1B1B1B", "red": "#D3202A", "green": "#3FA34D",
       "pink": "#F4949C", "grey": "#9EA3A8", "wood": "#D9B48A"}
H, D, C = 36.0, 33.0, 6.0            # body height, depth from the wall, facet chamfer
CY, CZ = -D / 2, H / 2               # pencil axis in (y, z)
X_ER, X_FE, X_BO, X_CO, X_END = 0.0, 24.0, 44.0, 204.0, 236.0
TIP_LEN = 9.0
POCKET_R = (A.marker_d + 0.5) / 2    # 0.5 mm clearance on the diameter
POCKET_DEPTH = 30.0
POCKET_Y = -14.0
mag_d, mag_t = (float(v) for v in A.magnet.lower().split("x"))
MAG_R, MAG_DEPTH = (mag_d + 0.2) / 2, mag_t + 0.2   # 0.2 mm press-fit clearance
RAISE = 1.0
PEG, PEG_LEN, PEG_CLR = 8.0, 8.0, 0.2
checks = {"name": A.name, "marker_d": A.marker_d, "pocket_d": round(2 * POCKET_R, 2),
          "magnet": f"{mag_d:g} x {mag_t:g} mm", "magnet_pocket": f"{2 * MAG_R:.1f} x {MAG_DEPTH:.1f} mm"}

# local frame for anything along the pencil: (u, v, w) = (y, z, x)
TO_WORLD = [[0, 0, 1, 0], [1, 0, 0, 0], [0, 1, 0, 0]]


def along_x(shape_yz, x0, x1):
    return L.extrude(shape_yz, x0, x1).transform(TO_WORLD)


profile = Polygon([(0, 0), (0, H), (-(D - C), H), (-D, H - C), (-D, C), (-(D - C), 0)])
back_clip = box(-100, -100, 0, 100)


def round_yz(r):
    return Point(CY, CZ).buffer(r, quad_segs=48).intersection(back_clip)


diamond = affinity.rotate(box(CY - PEG / 2, CZ - PEG / 2, CY + PEG / 2, CZ + PEG / 2), 45, origin=(CY, CZ))
diamond_hole = affinity.rotate(box(CY - PEG / 2 - PEG_CLR, CZ - PEG / 2 - PEG_CLR, CY + PEG / 2 + PEG_CLR, CZ + PEG / 2 + PEG_CLR),
                               45, origin=(CY, CZ))

# ------------------------------------------------------------------ body A --
body = along_x(profile, X_BO, X_CO)
# Joints: diamond HOLES in both ends of the body and two loose dowels, not pegs on the body.
# A peg sticking out of the end of a part that prints lying down starts its lowest edge in mid-air;
# the slicer flags it ("floating cantilever", print check 2026-11-01). A diamond hole lying down has a
# 45-degree roof and prints clean, and the dowels print standing up.
body = body - along_x(diamond_hole, X_BO - 0.1, X_BO + PEG_LEN + 0.4) - along_x(diamond_hole, X_CO - PEG_LEN - 0.4, X_CO + 0.1)
# marker pockets: truncated teardrop pointing to the front (up, when printed on its back)
td = unary_union([Point(0, 0).buffer(POCKET_R, quad_segs=48),
                  Polygon([(-POCKET_R / math.sqrt(2), -POCKET_R / math.sqrt(2)), (0, -POCKET_R * math.sqrt(2)),
                           (POCKET_R / math.sqrt(2), -POCKET_R / math.sqrt(2))])])
td = td.intersection(box(-50, -(POCKET_R + 1.0), 50, 50))
pocket_xs = [X_BO + 160 * f for f in (0.2, 0.4, 0.6, 0.8)]
pockets = L.union([L.extrude(affinity.translate(td, px, POCKET_Y), H - POCKET_DEPTH, H + 1) for px in pocket_xs])
body = body - pockets
# magnet pockets in the back (open onto the bed when printed)
mag_xs = [X_BO + 160 * f for f in (0.12, 0.37, 0.63, 0.88)]
mags = L.union([m3d.Manifold.cylinder(MAG_DEPTH + 0.01, MAG_R, MAG_R, 64).rotate((90, 0, 0)).translate((mx, 0.01, CZ))
                for mx in mag_xs])
body = body - mags

# raised name + apple on the front face (x, z), 1 mm proud
FRONT = [[1, 0, 0, 0], [0, 0, -1, -D], [0, 1, 0, 0]]


def front(shape_xz, depth=RAISE):
    return L.extrude(shape_xz, 0, depth).transform(FRONT)


txt = A.name.upper() if A.upper == "1" else A.name
name2d = L.text_shape(txt, "Poppins-Bold.ttf", cap_mm=12.0)
face_lo, face_hi = C + 1.5, H - C - 1.5
name2d, s_nm = L.fit_center(name2d, X_BO + 74, CZ - 0.3, max_w=124.0, max_h=face_hi - face_lo)
nb = name2d.bounds
ax, az = nb[2] + 11.0, CZ - 0.6
apple = unary_union([Point(ax - 2.3, az).buffer(4.9, quad_segs=24), Point(ax + 2.3, az).buffer(4.9, quad_segs=24),
                     Point(ax, az - 2.6).buffer(4.0, quad_segs=24)])
apple = apple.difference(Point(ax, az + 6.1).buffer(1.8, quad_segs=16))
stem = LineString([(ax - 0.2, az + 3.6), (ax + 0.6, az + 7.6)]).buffer(0.75, cap_style="round")
leaf = affinity.rotate(affinity.scale(Point(0, 0).buffer(1, quad_segs=24), 3.0, 1.4), 28).buffer(0)
leaf = affinity.translate(leaf, ax + 3.4, az + 7.0)
stem = stem.difference(apple)
leaf = leaf.difference(unary_union([apple, stem.buffer(0.05)]))
black2d = unary_union([name2d, stem])
checks["name_cap_mm"] = round(12.0 * s_nm, 2)
checks["name_stroke_thinner_than_0.8mm_mm2"] = [round(x, 3) for x in L.thin_report(name2d, 0.8)]
checks["apple_right_edge_x"] = round(max(apple.bounds[2], leaf.bounds[2]), 1)
assert max(apple.bounds[2], leaf.bounds[2]) < X_CO - 2, "name too long for the pencil"

parts = {
    "A_yellow_body": body,
    "A_black_name": front(black2d),
    "A_red_apple": front(apple),
    "A_green_leaf": front(leaf),
}

# ------------------------------------------------------ eraser + ferrule B --
ER_R, FE_R = 16.6, 17.4
eraser = along_x(round_yz(ER_R), X_ER + 1.5, X_FE)
eraser = eraser + m3d.Manifold.batch_hull([along_x(round_yz(ER_R - 1.5), X_ER, X_ER + 0.01),
                                           along_x(round_yz(ER_R), X_ER + 1.5, X_ER + 1.51)])
ferrule = along_x(round_yz(FE_R), X_FE + 1.0, X_BO) + m3d.Manifold.batch_hull(
    [along_x(round_yz(ER_R), X_FE, X_FE + 0.01), along_x(round_yz(FE_R), X_FE + 1.0, X_FE + 1.01)])  # 45-deg step up from the eraser


def ring_groove(x, r, depth=0.8, half=1.0):
    cs = m3d.CrossSection([[(r - depth, 0.0), (r + 1.5, -half * 2.6), (r + 1.5, half * 2.6)]])  # >= 45 deg faces
    ring = m3d.Manifold.revolve(cs, 96)
    # revolve is about local z: put that axis on the pencil axis (world x)
    return ring.transform(TO_WORLD).translate((x, CY, CZ))


for gx in (X_FE + 4.0, X_FE + 8.5, X_FE + 11.5, X_FE + 16.0):
    ferrule = ferrule - ring_groove(gx, FE_R)
ferrule = ferrule - along_x(diamond_hole, X_BO - PEG_LEN - 0.4, X_BO + 0.1)
ferrule = ferrule - along_x(box(0, -100, 100, 100), X_FE, X_BO)  # keep the flat back flat
parts["B_pink_eraser"] = eraser
parts["B_grey_ferrule"] = ferrule

# ----------------------------------------------------------- cone + tip C --
apex = m3d.Manifold.sphere(0.4, 16).translate((X_END, -14.0, CZ))
cone = m3d.Manifold.batch_hull([along_x(profile, X_CO, X_CO + 0.01), apex])
tip_split = X_END - TIP_LEN
hole = m3d.Manifold.batch_hull([along_x(diamond_hole, X_CO - 0.1, X_CO + PEG_LEN + 0.4),
                                m3d.Manifold.sphere(0.2, 8).translate((X_CO + PEG_LEN + 0.4 + PEG / 1.4, CY, CZ))])
cone = cone - hole
cut = m3d.Manifold.cube((100, 200, 200), True).translate((tip_split + 50, 0, 0))
parts["C_wood_cone"] = cone - cut
parts["C_black_tip"] = cone ^ cut

# ----------------------------------------------------------------- checks --
parts = {k: v.set_tolerance(0.005).simplify(0.01) for k, v in parts.items()}  # merges revolve/clip slivers (5-10 micron)
ov = {}
ks = list(parts)
for i in range(len(ks)):
    for j in range(i + 1, len(ks)):
        v = (parts[ks[i]] ^ parts[ks[j]]).volume()
        if v > 0.0005:
            ov[f"{ks[i]}&{ks[j]}"] = round(v, 4)
checks["part_overlap_mm3"] = ov or "none"
allm = L.union(list(parts.values()))
bb = allm.bounding_box()
checks["assembled_bbox_mm"] = [round(bb[3] - bb[0], 1), round(bb[4] - bb[1], 1), round(bb[5] - bb[2], 1)]
checks["walls_mm"] = {"pocket_to_magnet_pocket": round(-POCKET_Y - POCKET_R - MAG_DEPTH, 2),
                      "pocket_to_front_facet_perp": round(((D - C) - (-POCKET_Y + POCKET_R + 1.0)) / math.sqrt(2), 2),
                      "pocket_floor": round(H - POCKET_DEPTH, 1), "between_pockets": round(32 - 2 * POCKET_R, 2)}

import bpy
# print layouts (each plate's parts keep their relative places)
PRINT_A = [[1, 0, 0, -X_BO], [0, 0, 1, 0], [0, -1, 0, 0]]      # back on the bed, front up
PRINT_UP = [[0, 1, 0, 0], [0, 0, 1, 0], [1, 0, 0, 0]]          # pencil axis vertical
plates = {"A": [], "B": [], "C": []}
os.makedirs(A.out, exist_ok=True)
for key, m in parts.items():
    pl = key[0]
    if pl == "A":
        pm = m.transform(PRINT_A)
    elif pl == "B":
        pm = m.transform(PRINT_UP)
    else:
        pm = m.transform(PRINT_UP).translate((0, 0, -X_CO))
    zmin = pm.bounding_box()[2]
    plates[pl].append((key, pm))
oh = {}
for pl, items in plates.items():
    z0 = min(pm.bounding_box()[2] for _, pm in items)
    for key, pm in items:
        L.write_stl(pm.translate((0, 0, -z0)), os.path.join(A.out, f"{SLUG}_{key}.stl"), clean=True)
    # judged on the whole plate: a colour part resting on another is not an overhang
    whole = L.union([pm for _, pm in items]).translate((0, 0, -z0))
    a, w, lz = L.overhang_report(whole)
    oh[f"plate_{pl}"] = {"area_mm2": round(a, 2), "worst_deg": round(w, 1), "lowest_z": None if lz is None else round(lz, 2)}
checks["overhang_over_45deg_in_print_pose"] = oh
# the two joint dowels: 8 mm square, 16 mm long (8 into each part, 0.8 mm of slack), 0.4 mm lead-in chamfers,
# printed standing on end on the eraser plate
_sq = lambda w, z: L.extrude(box(-w / 2, -w / 2, w / 2, w / 2), z, z + 0.01)
dowel = m3d.Manifold.batch_hull([_sq(PEG - 0.8, 0), _sq(PEG, 0.4), _sq(PEG, 2 * PEG_LEN - 0.41), _sq(PEG - 0.8, 2 * PEG_LEN - 0.01)])
L.write_stl(dowel, os.path.join(A.out, f"{SLUG}_B_grey_dowel.stl"), clean=True)
checks["joint"] = {"type": "2 loose diamond dowels", "dowel_mm": f"{PEG:g} x {PEG:g} x {2 * PEG_LEN:g}",
                   "hole_clearance_mm": PEG_CLR, "hole_depth_mm": PEG_LEN + 0.4}
checks["overhang_note"] = ("plate A's flat roofs are bridges, by design: the 4 magnet pockets (20.2 mm span, 3.2 mm up) "
                           "and the 4 marker-pocket teardrop tops (about 5.7 mm span). PLA bridges both without supports.")

L.reset_scene()
p3 = {}
for key, m in parts.items():
    ob = L.bl_mesh("chk_" + key, m, clean=True)
    p3[key] = L.print3d_check(ob)
    bpy.data.objects.remove(ob)
checks["print3d"] = p3
print("CHECKS", json.dumps(checks, indent=1))

if not A.no_slice:
    # The print file comes from the same path as the product's PRINT.3mf: print_spec.json (pencil body,
    # eraser + ferrule + dowels, cone + tip, the fit-test plate) re-pointed at this run's STLs, through
    # print_check.py, then held up against the product's file (task e912b835). Never slice an order
    # through itp_slice.py: Cool Plate (35 C bed, the first layer lifts on our PEI), 0.20 mm, 2 walls,
    # no ironing, no N2S stamp (the A1 refuses it).
    order_print.make_print(HERE, A.out, started=T0,
                           rename={"Mrs. Johnson": A.name, "MRS. JOHNSON": A.name.upper()})

# ------------------------------------------------------------- the scene --
board = L.add_plane("Whiteboard", 3.0, (0, 0.0005, 0), rot=(math.radians(90), 0, 0), color=(0.92, 0.93, 0.94), rough=0.25)
colof = {"A_yellow_body": "yellow", "A_black_name": "black", "A_red_apple": "red", "A_green_leaf": "green",
         "B_pink_eraser": "pink", "B_grey_ferrule": "grey", "C_wood_cone": "wood", "C_black_tip": "black"}
for key, m in parts.items():
    ob = L.bl_mesh(key, m.translate((-X_END / 2, 0, -CZ)), COL[colof[key]], rough=0.42 if key != "B_grey_ferrule" else 0.3)
    if key == "B_grey_ferrule":
        ob.data.materials[0].node_tree.nodes["Principled BSDF"].inputs["Metallic"].default_value = 0.6
# four markers standing in the pockets (stand-ins for the render only)
for i, (px, cap) in enumerate(zip(pocket_xs, ("#111111", "#1D4FBF", "#C81E25", "#1E8A3A"))):
    x, y = (px - X_END / 2) / 1000, (POCKET_Y) / 1000
    bpy.ops.mesh.primitive_cylinder_add(radius=A.marker_d / 2000 - 0.0004, depth=0.105, location=(x, y, (H - POCKET_DEPTH - CZ) / 1000 + 0.0525))
    barrel = bpy.context.active_object
    mb = bpy.data.materials.new(f"barrel{i}")
    mb.use_nodes = True
    mb.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.92, 0.92, 0.92, 1)
    mb.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.3
    barrel.data.materials.append(mb)
    bpy.ops.mesh.primitive_cylinder_add(radius=A.marker_d / 2000, depth=0.03,
                                        location=(x, y, (H - POCKET_DEPTH - CZ) / 1000 + 0.105 + 0.015))
    capo = bpy.context.active_object
    mc = bpy.data.materials.new(f"cap{i}")
    mc.use_nodes = True
    mc.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*L.hex_lin(cap), 1)
    mc.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.35
    capo.data.materials.append(mc)
L.add_world((0.85, 0.88, 0.92), 0.08)
key = L.add_light("AREA", (-0.25, -0.45, 0.35), 9, size=0.8, color=(1.0, 0.97, 0.92), name="Window")
L.look_at(key, (0, 0, 0))
fill = L.add_light("AREA", (0.35, -0.3, -0.1), 3, size=0.6, name="Fill")
L.look_at(fill, (0, 0, 0))

if not A.no_render:
    L.setup_render(1600, 1200, samples=192)
    L.add_camera((-0.21, -0.33, 0.10), (0.02, -0.012, 0.04), lens=40, dof_target=(0.0, -0.02, 0.0), fstop=8.0)
    L.render(os.path.join(A.out, "render.png"))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(A.out, f"{SLUG}.blend"))
json.dump(checks, open(os.path.join(A.out, "checks.json"), "w"), indent=1)
print("DONE", A.out)
