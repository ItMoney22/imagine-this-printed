#!/usr/bin/env python3
"""ITP print check: build the final Bambu project, slice it for real, and prove it prints.

usage: ~/.local/share/itp-print-check/venv/bin/python print_check.py <product_dir>/print_spec.json

The second pair of eyes behind the modeller (job 20261101-itp-print-picks-print-check).
It does what a person would do in Bambu Studio before pressing print, and writes down
what it saw:

  1. builds the project through the CLI's --load-assemble-list (named plates, one
     filament per part, parts of one product kept as ONE object so nothing sinks),
     every process and filament setting flattened and saved inside the 3mf;
  2. slices every plate, stamps printer_model_id N2S (the CLI leaves it empty and the
     A1 then silently refuses the file) and saves <slug>-PRINT.3mf;
  3. reads the slice back: return code, slicer warnings, layer height and bed type
     actually in the file, grams per filament, time, AMS loads, flush grams, empty
     layers;
  4. COVERAGE: for every layer it slices the mesh itself at that height and rasterises
     the toolpaths the slicer wrote. Model area the nozzle never visits is a region the
     slicer dropped (a thin stroke, a hairline bridge). Per part it also checks the
     area is printed in THAT part's filament, so a colour that was silently dropped
     shows up as a number, not as a surprise on the plate;
  5. geometry: first-layer contact area vs height (tip-over risk), downward overhangs
     steeper than 45 deg off the bed, strokes narrower than two perimeters;
  6. renders: a 3D view of the actual toolpaths in filament colours, and top-down
     layer views with any dropped area painted red.

Deps (venv, $0): numpy pillow trimesh shapely scipy rtree
  python3 -m venv ~/.local/share/itp-print-check/venv && \
  ~/.local/share/itp-print-check/venv/bin/pip install numpy pillow trimesh shapely scipy rtree

print_spec.json:
  {"slug": "shadow-ornament", "process": "0.16mm Optimal @BBL A1",
   "overrides": {...process keys...},
   "colors": ["#FFFFFF"], "color_names": ["Bambu PLA Basic Jade White"],
   "flush_volumes_matrix": [...n*n mm3, optional...],
   "plates": [{"name": "...", "objects": [{"name": "...", "parts": [
       {"stl": "a.stl", "slot": 1, "subtype": "normal_part"}],
       "print_params": {...per object...}}]}]}
"""
import json, math, os, re, shutil, signal, subprocess, sys, time, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from itp_slice import flatten, fmt_time, PROFILES, SLICER, MACHINE, FILAMENT  # noqa: E402
from itp_slice import run as _run  # noqa: E402


def run(args, expected, label, timeout=900):
    """The flatpak CLI keeps its scratch in one /tmp/bamboo_model/<date>/<hh_mm_ss> folder, so two
    exports started in the same second (this check and the modeller's slice, say) clobber each other:
    "Unable to add file ... _temp_1.config to archive". Retry after a pause."""
    import random
    for attempt in range(4):
        try:
            return _run(args, expected, label, timeout)
        except RuntimeError as e:
            if attempt == 3 or "Unable to add file" not in str(e) and "produced nothing" not in str(e):
                raise
            time.sleep(3 + random.random() * 5)

import numpy as np  # noqa: E402
import trimesh  # noqa: E402
from shapely.geometry import Polygon, MultiPolygon, LineString  # noqa: E402
from shapely.ops import unary_union  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402
from scipy import ndimage  # noqa: E402

BED = 256.0
NON_OBJECT = {"Brim", "Skirt", "Prime tower", "Wipe tower", "Custom", "Support", "Support interface",
              "Support transition", "Undefined"}

# Shop rules every ITP print starts from. Product specs override per product.
SHOP = {
    "curr_bed_type": "Textured PEI Plate",   # vendor default is Cool Plate: 35 C bed on our PEI = first layer lifts
    "enable_support": "0",
    "brim_object_gap": "0.1",
    "wall_generator": "arachne",             # thin letter strokes get a variable-width bead instead of vanishing
    "seam_position": "back",
    "enable_arc_fitting": "1",
}


# ------------------------------------------------------------------ build --

def with_templates(machine):
    """Bambu Studio 02.08 moved the A1's real gcode out of the preset chain into sibling files,
    "<machine> template machine_start_gcode.json" and four more. Walking `inherits` alone lands
    on fdm_machine_common's generic start gcode: no AMS load (no M620 S<n>A), no A1 purge line
    or bed routine. The CLI slices it without a word. Merge the templates back in."""
    name = os.path.splitext(os.path.basename(MACHINE))[0]
    folder = os.path.join(PROFILES, os.path.dirname(MACHINE))
    for f in sorted(os.listdir(folder)):
        if f.startswith(name + " template ") and f.endswith(".json"):
            t = json.load(open(os.path.join(folder, f)))
            for k, v in t.items():
                if k not in ("name", "instantiation", "inherits", "from", "setting_id", "type"):
                    machine[k] = v
    if "M620 S[" not in machine.get("machine_start_gcode", "") and "M620 S" not in machine.get("machine_start_gcode", ""):
        raise RuntimeError("A1 start gcode has no AMS load after merging templates: refusing to slice")
    return machine


def build(spec, folder):
    slug = spec["slug"]
    work = os.path.join(folder, "_printcheck")
    if os.path.isdir(work):
        shutil.rmtree(work)
    os.makedirs(work)
    colors = spec["colors"]
    n = len(colors)

    machine = with_templates(flatten(MACHINE))
    process = flatten("process/" + spec["process"] + ".json")
    process.update(SHOP)
    process.update(spec.get("overrides", {}))
    if n > 1:
        process.setdefault("enable_prime_tower", "1")
    else:
        process["enable_prime_tower"] = "0"
    filament = flatten(FILAMENT)
    # the GUI shows the preset it was derived from; keep the vendor names so it maps cleanly
    for nm, obj in (("machine", machine), ("process", process), ("filament", filament)):
        json.dump(obj, open(os.path.join(work, nm + ".json"), "w"), indent=1)
    mf, pf, ff = (os.path.join(work, x + ".json") for x in ("machine", "process", "filament"))
    common = ["--load-settings", f"{mf};{pf}", "--load-filaments", ";".join([ff] * n)]

    drop_to_bed(spec, folder)
    plates = []
    for pi, p in enumerate(spec["plates"], start=1):
        objs = []
        for oi, obj in enumerate(p["objects"], start=1):
            for qi, part in enumerate(obj["parts"], start=1):
                src = os.path.join(folder, part["stl"])
                # a unique file per part: the slicer names parts after their file, and the same STL used
                # twice in two colours (a dowel on its own plate and on the fit-test plate) got ONE colour
                part["_file"] = f"p{pi}o{oi}q{qi}_" + os.path.basename(part["stl"])
                dst = os.path.join(work, part["_file"])
                shutil.copy(src, dst)
                o = {"path": dst, "count": 1, "filaments": [part["slot"]], "assemble_index": [oi],
                     "pos_x": [part.get("x", 0.0)], "pos_y": [part.get("y", 0.0)], "pos_z": [part.get("z", 0.0)]}
                if part.get("subtype", "normal_part") != "normal_part":
                    o["subtype"] = part["subtype"]
                objs.append(o)
        pl = {"plate_name": p["name"], "need_arrange": False, "objects": objs,
              "plate_params": {"curr_bed_type": process["curr_bed_type"]}}
        ap = [{"assemble_index": oi, "print_params": obj["print_params"]}
              for oi, obj in enumerate(p["objects"], start=1) if obj.get("print_params")]
        if ap:
            pl["assembled_params"] = ap
        plates.append(pl)
    alist = os.path.join(work, "assemble_list.json")
    json.dump({"plates": plates}, open(alist, "w"), indent=1)

    project = os.path.join(work, "project.3mf")
    run(["--load-assemble-list", alist] + common + ["--export-3mf", "project.3mf", "--outputdir", work],
        project, "export")
    patch_project(project, spec, process)
    sliced = os.path.join(work, "sliced.3mf")
    run([project] + common + ["--slice", "0", "--export-3mf", "sliced.3mf", "--outputdir", work],
        sliced, "slice", timeout=1800)
    # the sliced project keeps the model, every setting and each plate's gcode: open it and press print
    final = os.path.join(folder, f"{slug}-PRINT.3mf")
    patch_sliced(sliced, final, spec)
    return work, final, process


def drop_to_bed(spec, folder):
    """set each part's z so its OBJECT sits on z=0. The CLI does not lift an assemble-list
    object that is partly below the bed: it slices away everything under z=0 (a 4 mm test cube
    centred on the origin came out 1.96 mm tall). Same offsets feed the coverage check."""
    for p in spec["plates"]:
        for o in p["objects"]:
            b = [trimesh.load(os.path.join(folder, part["stl"]), force="mesh").bounds
                 for part in o["parts"] if part.get("subtype", "normal_part") == "normal_part"]
            zmin = min(bb[0][2] for bb in b)
            cx = (min(bb[0][0] for bb in b) + max(bb[1][0] for bb in b)) / 2
            cy = (min(bb[0][1] for bb in b) + max(bb[1][1] for bb in b)) / 2
            off = o.get("bed_xy", [BED / 2, BED / 2])
            for part in o["parts"]:
                part["z"] = part.get("z_user", 0.0) - zmin
                # placed by us, not by the arranger: it rotated the ornament 52 deg to fit a box,
                # which moves "seam at the back" and the text direction off what was designed
                part["x"] = off[0] - cx
                part["y"] = off[1] - cy


def _rezip(src, dst, replace):
    tmp = dst + ".tmp"
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = replace[item.filename] if item.filename in replace else zin.read(item.filename)
            if isinstance(data, str):
                data = data.encode()
            zout.writestr(item, data)
    os.replace(tmp, dst)


def _settings_patch(cfg, spec):
    colors = spec["colors"]
    n = len(colors)
    cfg = dict(cfg)
    cfg["filament_colour"] = list(colors)
    cfg["default_filament_colour"] = [""] * n
    for k in list(cfg):
        v = cfg[k]
        # every per-filament array needs one entry per filament or a change to slot 2 has nowhere to go
        if isinstance(v, list) and k.startswith("filament_") and len(v) not in (0, n) and len(v) == 1:
            cfg[k] = v * n
    cfg["filament_map"] = ["1"] * n
    cfg["flush_volumes_matrix"] = [str(x) for x in (spec.get("flush_volumes_matrix") or flush_matrix(colors))]
    cfg["flush_volumes_vector"] = ["140"] * (2 * n)
    cfg["curr_bed_type"] = spec.get("bed", "Textured PEI Plate")
    return cfg


def _lum(hexc):
    r, g, b = (v / 255 for v in hex_rgb(hexc))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b, max(r, g, b) - min(r, g, b)


def flush_matrix(colors):
    """mm3 purged going from colour i to colour j. Same shape as Bambu's own calculator:
    a dark colour followed by a light one needs the most (black into white ~800), light
    into dark the least. Clamped to the slicer's 107..800 window for a 0.4 nozzle."""
    n = len(colors)
    out = []
    for i in range(n):
        for j in range(n):
            if i == j:
                out.append(0)
                continue
            li, ci = _lum(colors[i])
            lj, cj = _lum(colors[j])
            v = 160 + 640 * max(0.0, lj - li) + 120 * abs(ci - cj)
            out.append(int(max(107, min(800, round(v)))))
    return out


def patch_project(project, spec, process):
    with zipfile.ZipFile(project) as z:
        cfg = json.loads(z.read("Metadata/project_settings.config"))
        ms = z.read("Metadata/model_settings.config").decode()
    cfg = _settings_patch(cfg, spec)
    # Name each object after the product and put its filament on the OBJECT as well as the part.
    # A one-part object ignores a part-level extruder when it is sliced: the cube in the
    # 2026-11-01 test asked for slot 2, came out of the export with part extruder 2, and was
    # sliced in slot 1 with no message. assemble_index restarts per plate, so match on part names.
    part_owner = {}
    for p in spec["plates"]:
        for o in p["objects"]:
            for part in o["parts"]:
                stem = os.path.splitext(part["_file"])[0]
                part_owner[stem + "_1"] = (o["name"], o["parts"][0]["slot"], part["slot"])

    def fix(m):
        blk = m.group(0)
        pn = re.findall(r'<part[\s\S]*?<metadata key="name" value="([^"]+)"/>', blk)
        own = next((part_owner[x] for x in pn if x in part_owner), None)
        if not own:
            return blk
        name, obj_slot, _ = own
        head, rest = blk.split("<part", 1)
        head = re.sub(r'<metadata key="name" value="[^"]*"/>', f'<metadata key="name" value="{name}"/>', head, count=1)
        head = re.sub(r'\s*<metadata key="extruder" value="\d+"/>', "", head)
        head = head.replace(f'<metadata key="name" value="{name}"/>',
                            f'<metadata key="name" value="{name}"/>\n    <metadata key="extruder" value="{obj_slot}"/>', 1)
        def fixpart(pm):
            pb = pm.group(0)
            nm = re.search(r'<metadata key="name" value="([^"]+)"/>', pb)
            if not nm or nm.group(1) not in part_owner:
                return pb
            slot = part_owner[nm.group(1)][2]
            tag = f'<metadata key="extruder" value="{slot}"/>'
            if re.search(r'<metadata key="extruder" value="\d+"/>', pb):
                return re.sub(r'<metadata key="extruder" value="\d+"/>', tag, pb)
            return pb.replace(nm.group(0), nm.group(0) + "\n      " + tag, 1)
        rest = re.sub(r'^[\s\S]*', lambda mm: re.sub(r'<part\s[\s\S]*?</part>', fixpart, "<part" + mm.group(0)), rest, count=1)
        return head + rest
    ms = re.sub(r'<object id="\d+">[\s\S]*?</object>', fix, ms)
    _rezip(project, project, {"Metadata/project_settings.config": json.dumps(cfg, indent=4),
                              "Metadata/model_settings.config": ms})


def patch_sliced(sliced, final, spec):
    with zipfile.ZipFile(sliced) as z:
        info = z.read("Metadata/slice_info.config").decode()
    info = info.replace('<metadata key="printer_model_id" value=""/>', '<metadata key="printer_model_id" value="N2S"/>')
    _rezip(sliced, final, {"Metadata/slice_info.config": info})


# ------------------------------------------------------------- gcode read --

ARC_SEG = 0.3


G_PER_MM = math.pi * 0.875 ** 2 * 1.26 / 1000  # 1.75 mm PLA at 1.26 g/cm3


def parse_gcode(text, totals=None):
    """-> layers: list of dict(z, h, segs=[(x0,y0,x1,y1,width,filament,feature)], e_obj).
    totals (dict, filled in): grams per filament for the object, the prime tower and flushes."""
    if totals is None:
        totals = {}
    flushing = False
    layers = []
    cur = None
    x = y = 0.0
    fil = 0
    feat = ""
    width = 0.42
    zh = 0.0
    lh = 0.2
    for line in text.splitlines():
        if line.startswith(";"):
            if line.startswith("; FLUSH_START"):
                flushing = True
            elif line.startswith("; FLUSH_END"):
                flushing = False
            if line.startswith("; CHANGE_LAYER"):
                cur = {"z": None, "h": None, "segs": [], "e_obj": 0.0, "fils": set()}
                layers.append(cur)
            elif line.startswith("; Z_HEIGHT:"):
                zh = float(line.split(":")[1])
                if cur is not None:
                    cur["z"] = zh
            elif line.startswith("; LAYER_HEIGHT:"):
                lh = float(line.split(":")[1])
                if cur is not None and cur["h"] is None:  # ironing writes its own ~0.005 "height"; keep the layer's
                    cur["h"] = lh
            elif line.startswith("; FEATURE:"):
                feat = line.split(":", 1)[1].strip()
            elif line.startswith("; LINE_WIDTH:"):
                width = float(line.split(":")[1])
            continue
        if not line:
            continue
        c = line.split(";")[0].strip()
        if not c:
            continue
        if c[0] == "T":
            m = re.match(r"T(\d+)$", c)
            if m and int(m.group(1)) < 16:
                fil = int(m.group(1))
            continue
        if c[0] != "G":
            continue
        parts = c.split()
        cmd = parts[0]
        if cmd not in ("G0", "G1", "G2", "G3"):
            continue
        args = {}
        for p in parts[1:]:
            try:
                args[p[0]] = float(p[1:])
            except ValueError:
                pass
        nx, ny = args.get("X", x), args.get("Y", y)
        e = args.get("E", 0.0)
        if e != 0:  # net E: a retract and its un-retract cancel, so only plastic that left the nozzle counts
            t = totals.setdefault(fil, {"object": 0.0, "tower": 0.0, "flush": 0.0, "other": 0.0})
            if flushing:
                t["flush"] += e * G_PER_MM
            elif cur is None or feat in ("Custom", "Undefined", ""):
                t["other"] += e * G_PER_MM
            elif feat in ("Prime tower", "Wipe tower"):
                t["tower"] += e * G_PER_MM
            else:
                t["object"] += e * G_PER_MM
        if cur is not None and e > 0 and ("X" in args or "Y" in args) and feat not in NON_OBJECT:
            pts = [(x, y), (nx, ny)]
            if cmd in ("G2", "G3") and ("I" in args or "J" in args):
                cx, cy = x + args.get("I", 0.0), y + args.get("J", 0.0)
                r = math.hypot(x - cx, y - cy)
                a0 = math.atan2(y - cy, x - cx)
                a1 = math.atan2(ny - cy, nx - cx)
                if cmd == "G3" and a1 <= a0:
                    a1 += 2 * math.pi
                if cmd == "G2" and a1 >= a0:
                    a1 -= 2 * math.pi
                steps = max(2, int(abs(a1 - a0) * r / ARC_SEG))
                pts = [(cx + r * math.cos(a0 + (a1 - a0) * i / steps), cy + r * math.sin(a0 + (a1 - a0) * i / steps))
                       for i in range(steps + 1)]
            for (ax, ay), (bx, by) in zip(pts, pts[1:]):
                cur["segs"].append((ax, ay, bx, by, width, fil, feat))
            cur["e_obj"] += e
            cur["fils"].add(fil)
        x, y = nx, ny
    return layers


# --------------------------------------------------------------- geometry --

def load_parts(spec, folder):
    drop_to_bed(spec, folder)
    """-> list of (plate_idx, object_name, slot, trimesh) with part positions applied"""
    out = []
    for pi, p in enumerate(spec["plates"]):
        for obj in p["objects"]:
            for part in obj["parts"]:
                if part.get("subtype", "normal_part") != "normal_part":
                    continue
                m = trimesh.load(os.path.join(folder, part["stl"]), force="mesh")
                m.apply_translation([part.get("x", 0.0), part.get("y", 0.0), part.get("z", 0.0)])
                out.append((pi, obj["name"], part["slot"], m))
    return out


def section(mesh, z):
    """mesh cross-section at height z as a shapely geometry (even-odd fill, so holes stay holes)."""
    from shapely.ops import polygonize
    from shapely.geometry import MultiLineString
    segs = trimesh.intersections.mesh_plane(mesh, [0, 0, 1], [0, 0, z])
    if len(segs) == 0:
        return None
    # round so the two copies of each shared edge point meet; shapely.node() here broke rings
    s2 = np.round(segs[:, :, :2], 5)
    ml = MultiLineString([[tuple(a), tuple(b)] for a, b in s2 if tuple(a) != tuple(b)])
    polys = list(polygonize(ml))
    if not polys:
        return None
    g = Polygon()
    for pp in sorted(polys, key=lambda q: -q.area):
        g = g.symmetric_difference(Polygon(pp.exterior.coords).buffer(0))
    g = g.buffer(0)
    return g if not g.is_empty else None


def geometry_report(parts):
    meshes = [m for _, _, _, m in parts]
    allm = trimesh.util.concatenate(meshes)  # already dropped to the bed by drop_to_bed
    ext = allm.extents
    first = section(allm, 0.1)
    first_area = first.area if first is not None else 0.0
    n = allm.face_normals
    c = allm.triangles_center
    a = allm.area_faces
    off_bed = c[:, 2] > 0.25
    over45 = (n[:, 2] < -math.sin(math.radians(45))) & off_bed
    flat_down = (n[:, 2] < -0.985) & off_bed
    rep = {
        "extents_mm": [round(float(v), 2) for v in ext],
        "fits_a1": bool(all(v <= BED for v in ext)),
        "first_layer_contact_mm2": round(first_area, 1),
        "height_mm": round(float(ext[2]), 2),
        "height_over_sqrt_contact": round(float(ext[2]) / math.sqrt(first_area), 2) if first_area else None,
        "overhang_over45_mm2": round(float(a[over45].sum()), 1),
        "flat_downfacing_mm2": round(float(a[flat_down].sum()), 1),
        "overhang_z_range": [round(float(c[over45][:, 2].min()), 2), round(float(c[over45][:, 2].max()), 2)]
        if over45.any() else None,
        "watertight": [bool(m.is_watertight) for m in meshes],
    }
    return rep, allm


# --------------------------------------------------------------- coverage --

RES = 0.04  # mm per pixel


def raster_poly(draw, geom, ox, oy, fill):
    gs = geom.geoms if isinstance(geom, MultiPolygon) else [geom]
    for g in gs:
        draw.polygon([((px - ox) / RES, (py - oy) / RES) for px, py in g.exterior.coords], fill=fill)
        for hole in g.interiors:
            draw.polygon([((px - ox) / RES, (py - oy) / RES) for px, py in hole.coords], fill=0)


def coverage(layers, parts, plate_idx, erode=0.12, band=0.95):
    """model area at each layer that no toolpath covers, total and per filament.
    Only the outer `band` mm of every section is checked: that is where walls, letter strokes,
    bridges and loops live. Deeper inside, sparse infill leaves gaps on purpose."""
    pparts = [(slot, m) for pi, _, slot, m in parts if pi == plate_idx]
    if not pparts:
        return None
    allm = trimesh.util.concatenate([m for _, m in pparts])
    # align: gcode object bbox vs mesh bbox (the slicer centres/arranges the object)
    xs, ys = [], []
    for L in layers:
        for s in L["segs"]:
            xs += [s[0], s[2]]
            ys += [s[1], s[3]]
    if not xs:
        return None
    gb = (min(xs), min(ys), max(xs), max(ys))
    # drop_to_bed placed every part in plate coordinates ourselves (no arranger), and each plate's
    # gcode is in its own plate's coordinates, so mesh and toolpath already share a frame
    dx = dy = 0.0
    ox, oy = gb[0] - 2, gb[1] - 2
    W = int((gb[2] - gb[0] + 4) / RES) + 1
    H = int((gb[3] - gb[1] + 4) / RES) + 1
    res = {"align_mm": [round(dx, 2), round(dy, 2)], "layers": [], "missing_total_mm2": 0.0,
           "worst": None, "wrong_filament_mm2": 0.0}
    worst = (0, None, None)
    for li, L in enumerate(layers):
        if L["z"] is None or not L["segs"]:
            continue
        zc = L["z"] - (L["h"] or 0.2) / 2
        # filament coverage rasters
        fil_img = {}
        for s in L["segs"]:
            f = s[5]
            if f not in fil_img:
                fil_img[f] = Image.new("L", (W, H), 0)
            d = ImageDraw.Draw(fil_img[f])
            w = max(1, int(round(s[4] / RES)))
            d.line([((s[0] - ox) / RES, (s[1] - oy) / RES), ((s[2] - ox) / RES, (s[3] - oy) / RES)], fill=255, width=w)
            r = w / 2
            for (px, py) in ((s[0], s[1]), (s[2], s[3])):
                cx, cy = (px - ox) / RES, (py - oy) / RES
                d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
        anyf = np.zeros((H, W), bool)
        fa = {f: np.array(im) > 0 for f, im in fil_img.items()}
        for v in fa.values():
            anyf |= v
        miss_l = 0.0
        wrong_l = 0.0
        mask_all = np.zeros((H, W), bool)
        for slot, m in pparts:
            g = section(m, zc)
            if g is None:
                continue
            from shapely import affinity
            g0 = affinity.translate(g, dx, dy)
            g = g0.buffer(-erode).difference(g0.buffer(-band))
            if g.is_empty:
                continue
            im = Image.new("L", (W, H), 0)
            raster_poly(ImageDraw.Draw(im), g, ox, oy, 255)
            mk = np.array(im) > 0
            mask_all |= mk
            own = fa.get(slot - 1, np.zeros((H, W), bool))
            others = anyf & ~own
            wrong_l += float((mk & others & ~own).sum()) * RES * RES
        missing = mask_all & ~anyf
        lab, nlab = ndimage.label(missing)
        biggest = 0.0
        if nlab:
            sizes = ndimage.sum(missing, lab, range(1, nlab + 1))
            biggest = float(sizes.max()) * RES * RES
        miss_l = float(missing.sum()) * RES * RES
        res["missing_total_mm2"] += miss_l
        res["wrong_filament_mm2"] += wrong_l
        res["layers"].append({"i": li, "z": L["z"], "model_mm2": round(float(mask_all.sum()) * RES * RES, 2),
                              "missing_mm2": round(miss_l, 3), "biggest_gap_mm2": round(biggest, 3),
                              "wrong_filament_mm2": round(wrong_l, 3)})
        if biggest > worst[0]:
            k = int(np.argmax(sizes)) + 1
            cy_, cx_ = ndimage.center_of_mass(missing, lab, k)
            worst = (biggest, li, (round(ox + cx_ * RES, 1), round(oy + cy_ * RES, 1)))
    res["missing_total_mm2"] = round(res["missing_total_mm2"], 2)
    res["wrong_filament_mm2"] = round(res["wrong_filament_mm2"], 2)
    res["worst"] = {"layer": worst[1], "biggest_gap_mm2": round(worst[0], 3), "at_xy": worst[2]}
    res["frame"] = (ox, oy, W, H, dx, dy)
    return res


def thin_strokes(parts, plate_idx, zs, two_perim=0.84):
    """area per sampled layer narrower than two perimeters (opening by half that width)."""
    out = []
    pparts = [m for pi, _, _, m in parts if pi == plate_idx]
    allm = trimesh.util.concatenate(pparts)
    for z in zs:
        g = section(allm, z)
        if g is None:
            continue
        r = two_perim / 2
        opened = g.buffer(-r).buffer(r)
        thin = g.difference(opened.buffer(0.02))
        gs = list(thin.geoms) if hasattr(thin, "geoms") else ([thin] if not thin.is_empty else [])
        big = [t for t in gs if t.area > 0.05]
        out.append({"z": round(z, 2), "section_mm2": round(g.area, 1), "under_2_perimeters_mm2": round(thin.area, 2),
                    "pieces_over_0.05mm2": len(big),
                    "largest_mm2": round(max((t.area for t in big), default=0.0), 2)})
    return out


# ----------------------------------------------------------------- render --

def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def render_iso(layers, colors, path, size=1600, max_segs=900000):
    segs = []
    for L in layers:
        if L["z"] is None:
            continue
        for s in L["segs"]:
            segs.append((s[0], s[1], s[2], s[3], L["z"], s[5], s[6]))
    if not segs:
        return
    step = max(1, len(segs) // max_segs)
    segs = segs[::step]
    az, el = math.radians(-35), math.radians(32)
    ca, sa, ce, se = math.cos(az), math.sin(az), math.cos(el), math.sin(el)

    def proj(x, y, z):
        xr = x * ca - y * sa
        yr = x * sa + y * ca
        return xr, -(z * ce + yr * se), yr * ce - z * se  # screen x, screen y, depth (bigger = farther)
    P = [(proj(a, b, z), proj(c, d, z), f, ft) for a, b, c, d, z, f, ft in segs]
    xs = [p[0][0] for p in P] + [p[1][0] for p in P]
    ys = [p[0][1] for p in P] + [p[1][1] for p in P]
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
    sc = (size - 80) / max(maxx - minx, maxy - miny, 1e-6)
    padx = (size - (maxx - minx) * sc) / 2
    pady = (size - (maxy - miny) * sc) / 2
    img = Image.new("RGB", (size, size), (34, 36, 40))
    d = ImageDraw.Draw(img)
    # seen from above, print order IS painter's order: every layer is drawn over the ones under it
    lw = max(1, int(0.42 * sc * 0.9))
    for (a, b, f, ft) in P:
        base = hex_rgb(colors[f] if f < len(colors) else "#888888")
        k = 0.78 if ft == "Outer wall" else (1.0 if "Top" in ft or "Iron" in ft else 0.9)
        col = tuple(min(255, int(v * k)) for v in base)
        if base == (255, 255, 255) or sum(base) > 700:
            col = tuple(int(v * (0.86 if ft == "Outer wall" else 0.97)) for v in base)
        d.line([((a[0] - minx) * sc + padx, (a[1] - miny) * sc + pady), ((b[0] - minx) * sc + padx, (b[1] - miny) * sc + pady)],
               fill=col, width=lw)
    img.save(path)


def render_layers(layers, colors, cov, parts, plate_idx, picks, path, tile=520, band=0.95):
    if cov is None:
        return
    ox, oy, W, H, dx, dy = cov["frame"]
    pparts = [(slot, m) for pi, _, slot, m in parts if pi == plate_idx]
    tiles = []
    for li in picks:
        L = layers[li]
        sc = tile / max(W, H)
        im = Image.new("RGB", (W, H), (24, 24, 28))
        d = ImageDraw.Draw(im)
        zc = L["z"] - (L["h"] or 0.2) / 2
        from shapely import affinity
        for slot, m in pparts:
            g = section(m, zc)
            if g is not None:
                raster_poly(d, affinity.translate(g, dx, dy), ox, oy, (70, 70, 80))
        for s in L["segs"]:
            col = hex_rgb(colors[s[5]] if s[5] < len(colors) else "#888888")
            w = max(1, int(round(s[4] / RES)))
            d.line([((s[0] - ox) / RES, (s[1] - oy) / RES), ((s[2] - ox) / RES, (s[3] - oy) / RES)], fill=col, width=w)
        # missing in red, recomputed for the pick
        arr = np.array(im)
        model = np.zeros((H, W), bool)
        for slot, m in pparts:
            g = section(m, zc)
            if g is not None:
                g0 = affinity.translate(g, dx, dy)
                g = g0.buffer(-0.15).difference(g0.buffer(-band))
                if not g.is_empty:
                    mi = Image.new("L", (W, H), 0)
                    raster_poly(ImageDraw.Draw(mi), g, ox, oy, 255)
                    model |= np.array(mi) > 0
        bare = model & (arr == np.array([70, 70, 80])).all(axis=2)
        arr[bare] = (255, 0, 0)
        im = Image.fromarray(arr).transpose(Image.FLIP_TOP_BOTTOM)
        im = im.resize((max(1, int(W * sc)), max(1, int(H * sc))), Image.LANCZOS)
        canvas = Image.new("RGB", (tile, tile + 30), (24, 24, 28))
        canvas.paste(im, (0, 30))
        ImageDraw.Draw(canvas).text((8, 8), f"layer {li + 1}/{len(layers)}  z={L['z']:.2f}mm", fill=(230, 230, 230))
        tiles.append(canvas)
    cols = min(3, len(tiles))
    rows = math.ceil(len(tiles) / cols)
    sheet = Image.new("RGB", (cols * tile, rows * (tile + 30)), (24, 24, 28))
    for i, t in enumerate(tiles):
        sheet.paste(t, ((i % cols) * tile, (i // cols) * (tile + 30)))
    sheet.save(path)


# ------------------------------------------------------------------- main --

def main(spec_path):
    spec = json.load(open(spec_path))
    folder = os.path.dirname(os.path.abspath(spec_path))
    slug = spec["slug"]
    work, final, process = build(spec, folder)
    out = {"slug": slug, "final": final, "process_name": spec["process"], "plates": []}
    with zipfile.ZipFile(final) as z:
        names = z.namelist()
        info = z.read("Metadata/slice_info.config").decode()
        pset = json.loads(z.read("Metadata/project_settings.config"))
        for i in range(1, len(spec["plates"]) + 1):
            if f"Metadata/plate_{i}.png" in names:
                open(os.path.join(work, f"plate_{i}.png"), "wb").write(z.read(f"Metadata/plate_{i}.png"))
    res = json.load(open(os.path.join(work, "result.json"))) if os.path.exists(os.path.join(work, "result.json")) else {}
    out["cli"] = {"return_code": res.get("return_code"), "error": res.get("error_string"),
                  "warnings": [p.get("warning_message") for p in res.get("sliced_plates", [])]}
    keys = ["layer_height", "initial_layer_print_height", "curr_bed_type", "wall_loops", "wall_generator",
            "top_shell_layers", "bottom_shell_layers", "sparse_infill_density", "sparse_infill_pattern",
            "ironing_type", "seam_position", "brim_type", "brim_width", "enable_support", "support_type",
            "enable_prime_tower", "flush_into_infill", "flush_into_objects", "prime_tower_width",
            "textured_plate_temp", "nozzle_temperature", "filament_colour", "printer_settings_id",
            "print_settings_id", "filament_settings_id", "flush_volumes_matrix", "top_surface_pattern",
            "outer_wall_speed", "detect_thin_wall", "only_one_wall_top"]
    out["settings_in_file"] = {k: pset.get(k) for k in keys}
    out["model_id_stamped"] = 'printer_model_id" value="N2S"' in info
    parts = load_parts(spec, folder)
    plate_blocks = re.findall(r"<plate>[\s\S]*?</plate>", info)
    for i, p in enumerate(spec["plates"], start=1):
        blk = plate_blocks[i - 1] if i - 1 < len(plate_blocks) else ""
        with zipfile.ZipFile(final) as z:
            gname = f"Metadata/plate_{i}.gcode"
            gcode = z.read(gname).decode(errors="replace") if gname in z.namelist() else ""
        totals = {}
        layers = parse_gcode(gcode, totals)
        fils = re.findall(r'<filament id="(\d+)"[^>]*used_m="([\d.]+)" used_g="([\d.]+)"', blk)
        pred = re.search(r'key="prediction" value="([\d.]+)"', blk)
        weight = re.search(r'key="weight" value="([\d.]+)"', blk)
        empty = [li + 1 for li, L in enumerate(layers) if L["z"] is not None and not L["segs"]]
        flush_g = None
        fl = re.search(r"; total filament used for wipe tower \[g\] = ([\d.]+)", gcode)
        # Bambu reports flush separately in the gcode header block
        m_flush = re.search(r"; filament used \[g\] = ([\d., ]+)", gcode)
        pl = {"name": p["name"], "layers": len(layers), "empty_layers": empty,
              "time_s": float(pred.group(1)) if pred else None,
              "time": fmt_time(float(pred.group(1))) if pred else None,
              "grams_total": float(weight.group(1)) if weight else None,
              "per_filament": [{"slot": int(a), "m": float(b), "g": float(c)} for a, b, c in fils],
              "ams_loads": len(re.findall(r"^\s*M620 S\d+A", gcode, re.M)),
              "tool_changes": len(re.findall(r"^\s*T([0-9]|1[0-5])\s*$", gcode, re.M)),
              "header_total_g": (re.search(r"; total filament weight \[g\] : ([\d.,]+)", gcode) or [None, None])[1],
              "header_time": (re.search(r"; model printing time: ([^;\n]+); total estimated time: ([^\n]+)", gcode).groups()
                              if "; model printing time" in gcode else None),
              "grams_from_gcode": {f"slot {f + 1}": {k: round(v, 2) for k, v in t.items()} for f, t in sorted(totals.items())},
              "filament_used_g_header": m_flush.group(1).strip() if m_flush else None,
              "wipe_tower_g": float(fl.group(1)) if fl else None,
              "max_z": float(re.search(r"; max_z_height: ([\d.]+)", gcode).group(1)) if "; max_z_height" in gcode else None,
              "bed_temp_cmds": sorted(set(re.findall(r"^M1[49]0 S(\d+)", gcode, re.M))),
              "warnings_in_slice_info": re.findall(r'<warning msg="([^"]+)"', blk)}
        pl["geometry"], _ = geometry_report([q for q in parts if q[0] == i - 1])
        wl = int(process.get("wall_loops", 2))
        band = 0.42 + (wl - 1) * 0.45 - 0.2  # the wall ring as printed (walls overlap ~0.15); inside it infill may be sparse
        cov = coverage(layers, parts, i - 1, erode=0.15, band=band)
        if cov:
            frame = cov.pop("frame")
            pl["coverage"] = {k: v for k, v in cov.items() if k != "layers"}
            pl["coverage"]["bad_layers"] = [l for l in cov["layers"] if l["biggest_gap_mm2"] > 0.5 or l["wrong_filament_mm2"] > 1.0]
            cov["frame"] = frame
            nz = [L["z"] for L in layers if L["z"] is not None]
            picks = sorted(set([0, len(layers) // 3, (2 * len(layers)) // 3, len(layers) - 1] +
                               ([cov["worst"]["layer"]] if cov["worst"]["layer"] is not None else [])))
            picks = [x for x in picks if 0 <= x < len(layers) and layers[x]["segs"]][:6]
            render_layers(layers, spec["colors"], cov, parts, i - 1, picks, os.path.join(folder, f"print-layers-plate{i}.png"), band=band)
            zs = sorted(set(round(z - 0.06, 3) for z in nz[:: max(1, len(nz) // 12)]))
            pl["thin_strokes"] = thin_strokes(parts, i - 1, zs)
        render_iso(layers, spec["colors"], os.path.join(folder, f"print-preview-plate{i}.png"))
        out["plates"].append(pl)
    json.dump(out, open(os.path.join(folder, "print-check.json"), "w"), indent=1, default=str)
    print(json.dumps({k: v for k, v in out.items()}, indent=1, default=str)[:6000])
    return out


if __name__ == "__main__":
    main(sys.argv[1])
