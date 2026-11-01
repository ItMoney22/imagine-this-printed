# usage: blender -b -P make_name_clicker.py -- --name EMMA [--caps "#F6A9BD,#BBA6E6"] [--out DIR] [--no-render] [--no-slice]
"""Name clicker keychain: a base with one MX clip-in socket per letter (14.0 mm square
in a 1.5 mm plate, 19.05 mm pitch), a keyring tab, and MX-stem keycaps with the letter
raised on top in a second colour. 3 to 8 letters; the base length follows the name.

Print layout (what gets sliced): the base upside down (plate on the bed, so the
sockets are crisp and the cavity roof bridges), the keycaps upright on their stems.
Nothing needs supports.
"""
import os, sys, json, math, time, argparse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "lib"))
import itp_lib as L
import manifold3d as m3d
from shapely.geometry import Point, box
from shapely.ops import unary_union
from shapely import affinity

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--name", default="EMMA")
ap.add_argument("--caps", default="#F6A9BD,#BBA6E6", help="keycap colours, cycled across the letters (max 2)")
ap.add_argument("--base-color", default="#5B5E63")
ap.add_argument("--letter-color", default="#1E1E1E")
ap.add_argument("--out", default=HERE)
ap.add_argument("--no-render", action="store_true")
ap.add_argument("--no-slice", action="store_true")
A = ap.parse_args(argv)
T0 = time.time()  # order_print refuses STLs older than this run
import order_print
order_print.refuse_product_folder(HERE, A.out, all(getattr(A, k) == ap.get_default(k)
                                                   for k in ("name", "caps", "base_color", "letter_color")))

SLUG = "name_clicker"
name = "".join(ch for ch in A.name.upper() if not ch.isspace())
assert 3 <= len(name) <= 8, "3 to 8 letters"
N = len(name)
cap_colors = [c.strip() for c in A.caps.split(",") if c.strip()][:2]

PITCH = 19.05
HOLE = 14.0          # MX plate cut-out
PLATE = 1.5          # MX clips are made for a 1.5 mm plate
CAV_W = 16.2         # room under the plate for the switch clips to spring out
CAV_D = 8.8          # switch body below the plate (5.0) + centre post and pins (3.3) + slack
FLOOR = 1.6
BASE_W = 22.0
END = 2.6            # end wall beyond the last socket's pitch box
H_BASE = PLATE + CAV_D + FLOOR
TAB_R, TAB_HOLE, TAB_T = 6.5, 3.0, 4.0

# keycap (DSA-like, flat top)
K_BOT, K_TOP, K_H = 18.0, 13.0, 7.6
K_WALL = 1.2
K_CEIL = 1.5
STEM_D = 5.6
CROSS_L, CROSS_W, CROSS_DEPTH = 4.15, 1.35, 4.0   # MX cross 4.0 x 1.17 + print clearance
LETTER_H = 0.6
checks = {"name": name, "letters": N}

# ------------------------------------------------------------------ base ---


def rrect(w, h, r, cx=0, cy=0):
    return box(cx - w / 2 + r, cy - h / 2 + r, cx + w / 2 - r, cy + h / 2 - r).buffer(r, quad_segs=12)


len_sockets = N * PITCH
base_len = len_sockets + 2 * END
xs = [(-len_sockets / 2 + PITCH / 2 + i * PITCH) for i in range(N)]
tab_cx = -base_len / 2 - TAB_R + 2.0
outline = unary_union([rrect(base_len, BASE_W, 3.5), Point(tab_cx, 0).buffer(TAB_R, quad_segs=32),
                       box(tab_cx, -TAB_R, -base_len / 2 + 3.5, TAB_R)])
tab_hole = Point(tab_cx - 0.8, 0).buffer(TAB_HOLE, quad_segs=32)
body_outline = rrect(base_len, BASE_W, 3.5)
cavity = rrect(len_sockets - 1.2, CAV_W, 1.0)
sockets = unary_union([box(x - HOLE / 2, -HOLE / 2, x + HOLE / 2, HOLE / 2) for x in xs])

# use orientation: floor at z=0, plate top at z=H_BASE
floor = L.extrude(body_outline, 0, FLOOR)
walls = L.extrude(body_outline.difference(cavity), FLOOR, H_BASE - PLATE)
plate = L.extrude(body_outline.difference(sockets), H_BASE - PLATE, H_BASE)
tab2d = unary_union([Point(tab_cx, 0).buffer(TAB_R, quad_segs=32), box(tab_cx, -TAB_R, -base_len / 2 + 3.5, TAB_R)])
tab = L.extrude(tab2d.difference(tab_hole), H_BASE - TAB_T, H_BASE)
base = L.union([floor, walls, plate, tab])
checks["base_mm"] = [round(base_len + 2 * TAB_R - 2.0, 1), BASE_W, round(H_BASE, 2)]
checks["base_wall_mm"] = {"side": round((BASE_W - CAV_W) / 2, 2), "end": round((base_len - (len_sockets - 1.2)) / 2, 2),
                          "plate_web_between_sockets": round(PITCH - HOLE, 2), "floor": FLOOR, "plate": PLATE}

# ---------------------------------------------------------------- keycap ---


def keycap(letter):
    outer = m3d.Manifold.batch_hull([L.extrude(rrect(K_BOT, K_BOT, 2.0), 0, 0.01),
                                     L.extrude(rrect(K_TOP, K_TOP, 1.8), K_H - 0.01, K_H)])
    ib = K_BOT - 2 * K_WALL
    it = K_TOP - 2 * 1.6
    inner = m3d.Manifold.batch_hull([L.extrude(rrect(ib, ib, 1.0), -0.1, 0.0),
                                     L.extrude(rrect(it, it, 1.0), K_H - K_CEIL - 0.01, K_H - K_CEIL)])
    stem = L.extrude(Point(0, 0).buffer(STEM_D / 2, quad_segs=32), 0, K_H - K_CEIL + 0.2)
    cross = L.extrude(unary_union([box(-CROSS_L / 2, -CROSS_W / 2, CROSS_L / 2, CROSS_W / 2),
                                   box(-CROSS_W / 2, -CROSS_L / 2, CROSS_W / 2, CROSS_L / 2)]), -0.1, CROSS_DEPTH)
    cap = (outer - inner) + stem - cross
    g = L.text_shape(letter, "Poppins-SemiBold.ttf", cap_mm=7.2)
    g, _ = L.fit_center(g, 0, 0, max_w=10.2, max_h=7.6)
    let = L.extrude(g, K_H, K_H + LETTER_H)
    return cap, let, g


caps, letters, glyphs = [], [], []
for i, ch in enumerate(name):
    c, l, g = keycap(ch)
    caps.append(c)
    letters.append(l)
    glyphs.append(g)
thin = [L.thin_report(g, 0.8) for g in glyphs]
checks["letter_stroke_thinner_than_0.8mm_mm2"] = {ch: [round(a, 3), round(b, 3)] for ch, (a, b) in zip(name, thin)}
checks["letter_height_mm"] = LETTER_H
checks["keycap_wall_mm"] = {"skirt": K_WALL, "ceiling": K_CEIL, "stem_around_cross_tip": round((STEM_D - CROSS_L) / 2, 2)}

# --------------------------------------------------------- layouts --------
os.makedirs(A.out, exist_ok=True)


def place(m, x, y, z=0.0):
    return m.translate((x, y, z))


# print layout: base flipped (plate on the bed), caps upright in a row in front of it
flip = base.rotate((180, 0, 0)).translate((0, 0, H_BASE))
print_parts = {"base": [flip]}
cap_y = BASE_W / 2 + 4 + K_BOT / 2
cap_pitch = K_BOT + 3.0
cap_x0 = -(N - 1) * cap_pitch / 2
slot_of_cap = {}
for i in range(N):
    col = cap_colors[i % len(cap_colors)]
    print_parts.setdefault(f"caps_{col}", []).append(place(caps[i], cap_x0 + i * cap_pitch, cap_y))
    print_parts.setdefault("letters", []).append(place(letters[i], cap_x0 + i * cap_pitch, cap_y))
colors = [A.base_color] + cap_colors + [A.letter_color]
color_names = ["Base (grey)"] + [f"Keycap colour {j + 1}" for j in range(len(cap_colors))] + ["Letters (black)"]
slot = {"base": 1, "letters": len(colors)}
for j, c in enumerate(cap_colors):
    slot[f"caps_{c}"] = 2 + j

stls, merged = [], {}
for key, ms in print_parts.items():
    m = L.union(ms)
    merged[key] = m
    fn = os.path.join(A.out, f"{SLUG}_{key.replace('#', '')}.stl")
    L.write_stl(m, fn)
    stls.append({"stl": fn, "slot": slot[key]})

# overlap check between colour bodies (letters sit ON the caps, they must not dig in)
ov = {}
keys = list(merged)
for i in range(len(keys)):
    for j in range(i + 1, len(keys)):
        v = (merged[keys[i]] ^ merged[keys[j]]).volume()
        ov[f"{keys[i]}&{keys[j]}"] = round(v, 4)
checks["part_overlap_mm3"] = ov
allp = L.union(list(merged.values()))
bb = allp.bounding_box()
checks["print_layout_bbox_mm"] = [round(bb[3] - bb[0], 1), round(bb[4] - bb[1], 1), round(bb[5] - bb[2], 1)]

# ------------------------------------------------------------- blender ----
import bpy
L.reset_scene()
p3 = {}
for key, m in merged.items():
    ob = L.bl_mesh("check_" + key, m)
    p3[key] = L.print3d_check(ob)
    bpy.data.objects.remove(ob)
checks["print3d"] = p3
print("CHECKS", json.dumps(checks, indent=1))

if not A.no_slice:
    # Production split. One 4-colour plate swaps filament on every layer the grey base
    # and the caps share (98 AMS loads for EMMA: 44 g and ~3 h, two thirds of it purge).
    # The same parts as one plate per colour group swap at most once, at the letter tops.
    prod = os.path.join(A.out, "production")
    os.makedirs(prod, exist_ok=True)
    for j, c in enumerate(cap_colors):
        idx = [i for i in range(N) if cap_colors[i % len(cap_colors)] == c]
        cm = L.union([place(caps[i], cap_x0 + i * cap_pitch, cap_y) for i in idx])
        lm = L.union([place(letters[i], cap_x0 + i * cap_pitch, cap_y) for i in idx])
        cf, lf = os.path.join(prod, f"caps_{j + 1}.stl"), os.path.join(prod, f"letters_{j + 1}.stl")
        L.write_stl(cm, cf)
        L.write_stl(lm, lf)
    # The print file comes from the same path as the product's PRINT.3mf: print_spec.json (base plate,
    # one plate per keycap colour, the fit-test plate) re-pointed at this run's STLs, through
    # print_check.py, then held up against the product's file (task e912b835). Never slice an order
    # through itp_slice.py: Cool Plate (35 C bed, the first layer lifts on our PEI), 2 walls, no
    # ironing or 0.12 mm keycap layers, one 4-colour plate, no N2S stamp (the A1 refuses it).
    # The spec's plate names carry EMMA's letter groups; swap in this name's.
    if len(cap_colors) != 2:
        raise SystemExit("the print file has one plate per keycap colour, two plates: give two --caps colours "
                         "(the same colour twice is fine)")
    cname = lambda c: {"#F6A9BD": "pink", "#BBA6E6": "lavender"}.get(c.upper(), f"colour {c.upper()}")
    grp = [name[j::2] for j in range(2)]  # cap i takes cap_colors[i % 2]
    order_print.make_print(HERE, A.out, colors=colors, started=T0, rename={
        "EMMA": name,
        "E + M (pink": f"{' + '.join(grp[0])} ({cname(cap_colors[0])}",
        "M + A (lavender": f"{' + '.join(grp[1])} ({cname(cap_colors[1])}",
        "pink E M": f"{cname(cap_colors[0])} {' '.join(grp[0])}",
        "lavender M A": f"{cname(cap_colors[1])} {' '.join(grp[1])}"})

# use layout for the product shot: switches seated, caps on the switches
coll = bpy.context.scene.collection
L.bl_mesh("Base", base, A.base_color, rough=0.5)
SW_TOP = H_BASE + 6.6  # keycap skirt bottom above the plate top on a seated MX switch (approx.)
# a simple stand-in for the clear switch housings so the render reads right (not printed)
for i, x in enumerate(xs):
    hous = L.extrude(rrect(15.4, 15.4, 0.8, x, 0), H_BASE, H_BASE + 5.2)
    L.bl_mesh(f"Switch{i}", hous, "#E8EEF2", rough=0.15)
    L.bl_mesh(f"Cap{i}", caps[i].translate((x, 0, SW_TOP - 0.0)), cap_colors[i % len(cap_colors)], rough=0.55)
    L.bl_mesh(f"Letter{i}", letters[i].translate((x, 0, SW_TOP)), A.letter_color, rough=0.5)
# switch housings are clear-ish
for o in bpy.data.objects:
    if o.name.startswith("Switch"):
        b = o.data.materials[0].node_tree.nodes["Principled BSDF"]
        b.inputs["Transmission Weight"].default_value = 0.6
# keyring
ring = bpy.data.objects.new("Ring", bpy.data.meshes.new("Ring"))
coll.objects.link(ring)
import bmesh
bm = bmesh.new()
bmesh.ops.create_circle(bm, cap_ends=False, radius=12.5, segments=96)
bm.to_mesh(ring.data)
bm.free()
ring.scale = (0.001, 0.001, 0.001)
ring.location = ((tab_cx - 0.8 - 11.0) / 1000, 0, 0.004)
ring.rotation_euler = (0, math.radians(-12), 0)
skin = ring.modifiers.new("Skin", "SKIN")
sub = ring.modifiers.new("Sub", "SUBSURF")
sub.levels = sub.render_levels = 2
for v in ring.data.skin_vertices[0].data:
    v.radius = (1.0, 1.0)
mt = bpy.data.materials.new("steel")
mt.use_nodes = True
bs = mt.node_tree.nodes["Principled BSDF"]
bs.inputs["Base Color"].default_value = (0.8, 0.8, 0.82, 1)
bs.inputs["Metallic"].default_value = 1.0
bs.inputs["Roughness"].default_value = 0.22
ring.data.materials.append(mt)

desk = L.add_plane("Desk", 2.0, (0, 0, 0), color=(0.30, 0.16, 0.07), rough=0.45)
L.add_world((0.55, 0.5, 0.45), 0.12)
key = L.add_light("AREA", (-0.25, -0.2, 0.35), 14, size=0.4, color=(1.0, 0.93, 0.84), name="Key")
L.look_at(key, (0, 0, 0))
rim = L.add_light("AREA", (0.3, 0.35, 0.2), 8, size=0.3, color=(0.9, 0.95, 1.0), name="Rim")
L.look_at(rim, (0, 0, 0))

blend = os.path.join(A.out, f"{SLUG}.blend")
if not A.no_render:
    L.setup_render(1600, 1200, samples=192)
    span = base_len + 2 * TAB_R + 30
    d = span / 1000 * 1.25
    L.add_camera((-d * 0.30, -d * 0.80, d * 0.62), (0.004, 0.002, 0.008), lens=50, dof_target=(0, -0.004, 0.012), fstop=4.0)
    L.render(os.path.join(A.out, "render.png"))
bpy.ops.wm.save_as_mainfile(filepath=blend)
json.dump(checks, open(os.path.join(A.out, "checks.json"), "w"), indent=1)
print("DONE", A.out)
