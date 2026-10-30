#!/usr/bin/env python3
"""Big QR counter stand, with the customer's logo printed in the middle of the code.

Own design (not the MakerWorld HAURAN model): a 92 x 120 mm plate with raised
QR + bottom text, and a separate triangular leg whose two tabs push into
pockets on the back of the plate so it leans back ~15 degrees.

  gen.py --url https://g.page/r/XXXX/review --text "Review Us" --logo logo.png --out Review-Stand.3mf

The logo is PRINTED IN, not a sticker (ITP, 2026-10-18): it becomes a one-colour
silhouette raised in the same black as the code, inside the ~25 mm square the code
leaves blank. Without --logo the square stays blank for a sticker, as before.

Every run scan-checks its own -face.png against the link and exits 3 when it does
not read back, so nothing that fails to scan can reach a printer.

Exit codes (stdout is always one JSON line):
  0 ok · 2 "use a shorter link" · 3 face did not scan back · 4 logo unusable · 1 anything else
"""
import argparse, io, math, os, re, sys, uuid, zipfile, json
import numpy as np, segno, trimesh, manifold3d as m3d
from shapely.geometry import Polygon, box
from shapely.ops import unary_union
from shapely import affinity
from matplotlib.textpath import TextPath
from matplotlib.font_manager import FontProperties

HERE = os.path.dirname(os.path.abspath(__file__))
WRAPPER = os.path.join(HERE, "wrapper")   # Bambu A1 project settings borrowed from Christina's Venmo stand
# Arial-style bold, like Crystal's "Pay Here". Omarchy has Liberation; Earth (Windows) has Arial itself.
FONT_CANDIDATES = [os.environ.get("QR_STAND_FONT", ""),
                   "/usr/share/fonts/liberation/LiberationSans-Bold.ttf",
                   "C:/Windows/Fonts/arialbd.ttf"]
FONT = next((f for f in FONT_CANDIDATES if f and os.path.exists(f)), FONT_CANDIDATES[1])

# QR version 6 at error level H holds 58 bytes. v7+ puts an alignment pattern dead
# centre, under the logo, so a longer link is refused rather than squeezed.
MAX_QR_VERSION = 6
MAX_LINK_BYTES = 58
TOO_LONG = "use a shorter link"

# Filament 2 in the wrapper's project settings is the black PLA; 1 is white.
FACE_FILAMENT, FACE_COLOUR = 2, "#161616"
LAYER_FIRST, LAYER = 0.2, 0.2              # 0.20 mm Standard, as the wrapper's settings say

# ---- dimensions (mm) ----
# Crystal's Venmo stand look at 1.5x: soft-edged plate, 75 mm QR, bold caption,
# angled leg with three slide-up hooks. Geometry drawn fresh here, not copied.
PW, PH, PT, PR = 90.0, 120.0, 6.0, 3.0     # plate width, height, thickness, plan corner radius
EDGE_R = 2.0                               # rounded top edge (the soft look)
QR_SIZE, QR_TOP = 75.0, 7.5                # QR edge length, margin from top edge
RAISE = 1.0                                # raised QR/text height
TEXT_Y, TEXT_CAP = 16.0, 8.5               # caption centre from bottom, cap height
BLANK_FRAC = 0.34                          # blank centre square, fraction of QR width (~1 inch)
SLOT_W = 4.4                               # hook slot width in the plate (unchanged since 2026-10-18)
LEG_T = 4.2                                # leg thickness: 0.1 mm a side in the slot (was 4.0, too loose)
LEAN = 15.0                                # degrees the plate leans back
LEG_LEN, LEG_TOP_W, LEG_FOOT = 113.5, 17.4, 69.3   # contact edge, flat top width, table edge
HOOKS = [31.0, 61.0, 91.0]                 # stem bottoms up the contact edge (final, locked position)
STEM_L, LIP_L = 12.0, 8.0                  # stem length along the edge, lip length past it
LEDGE, HOOK_D = 2.0, 3.8                   # plate back skin the lip slides behind, total hook depth
CLEAR = 0.2
LIP_FIT = 0.1                              # lip to skin gap (was 2 x CLEAR = 0.4: the stand rocked on its leg)


def rounded_rect(w, h, r):
    return box(r, r, w - r, h - r).buffer(r, resolution=16)


def to_manifold(poly, z0, z1):
    if poly.geom_type == "MultiPolygon":
        return m3d.Manifold.batch_boolean([to_manifold(p, z0, z1) for p in poly.geoms], m3d.OpType.Add)
    mesh = trimesh.creation.extrude_polygon(poly, z1 - z0)
    mesh.apply_translation([0, 0, z0])
    return m3d.Manifold(m3d.Mesh(vert_properties=np.asarray(mesh.vertices, np.float32),
                                 tri_verts=np.asarray(mesh.faces, np.uint32)))


class StandError(Exception):
    """A refusal the caller shows to a person, with the exit code that names it."""
    def __init__(self, message, code):
        super().__init__(message)
        self.code = code


def link_problem(url):
    """None when the link fits, else the words to show. Byte mode at level H, so the
    rule is the same one the shop's order page applies: 58 bytes of UTF-8."""
    if not url or not url.strip():
        return "type where the code should point"
    if len(url.encode("utf-8")) > MAX_LINK_BYTES:
        return TOO_LONG
    return None


def qr_geometry(url, size=QR_SIZE, top=QR_TOP, full=False):
    """full=True: the whole code, no blank centre square (no logo, no sticker). With
    nothing covering the middle it does not need level H, so it takes the smallest
    version (biggest modules) and the strongest level that version still holds."""
    problem = link_problem(url)
    if problem:
        raise StandError(problem, 2)
    # mode="byte" pins the encoding the shop's preview uses, so both agree on the version.
    if full:
        qr = segno.make(url, error="l", mode="byte", boost_error=True, micro=False)
    else:
        qr = segno.make(url, error="h", mode="byte", boost_error=False, micro=False)
    if qr.version > MAX_QR_VERSION:  # v7+ puts an alignment pattern dead centre, under the logo
        raise StandError(TOO_LONG, 2)
    mat = np.array([[bool(c) for c in row] for row in qr.matrix])
    n = mat.shape[0]
    k = 0 if full else max(5, int(round(n * BLANK_FRAC)))
    if k and (n - k) % 2: k += 1
    lo = (n - k) // 2
    mat[lo:lo + k, lo:lo + k] = False
    cell = size / n
    x0, y0 = (PW - size) / 2, PH - top - size
    sq = [box(x0 + c * cell, y0 + (n - 1 - r) * cell, x0 + (c + 1) * cell, y0 + (n - r) * cell)
          for r in range(n) for c in range(n) if mat[r, c]]
    blank = (x0 + lo * cell, y0 + (n - lo - k) * cell, k * cell)
    return unary_union(sq).buffer(0.01, join_style=2).buffer(-0.01, join_style=2), qr, blank, mat


def text_geometry(text):
    fp = FontProperties(fname=FONT)
    tp = TextPath((0, 0), text, size=1.0, prop=fp)
    shape = Polygon()
    for p in sorted((Polygon(p) for p in tp.to_polygons() if len(p) >= 3), key=lambda p: -p.area):
        shape = shape.symmetric_difference(p.buffer(0))   # even-odd: holes in e, a, R ...
    cap = TEXT_CAP
    s = cap / TextPath((0, 0), "H", size=1.0, prop=fp).get_extents().height
    shape = affinity.scale(shape, s, s, origin=(0, 0))
    minx, miny, maxx, maxy = shape.bounds
    if maxx - minx > PW - 14:  # long caption: shrink to fit
        f = (PW - 14) / (maxx - minx)
        shape = affinity.scale(shape, f, f, origin=(0, 0)); cap *= f
        minx, miny, maxx, maxy = shape.bounds
    # baseline sits at y=0: centre the capitals, so descenders (y, p) hang below like normal type
    return affinity.translate(shape, PW / 2 - (minx + maxx) / 2, TEXT_Y - cap / 2)


# ---- the logo, printed in ----
LOGO_RES = 0.1          # mm per pixel the silhouette is traced at
LOGO_MIN_FEATURE = 0.4  # one nozzle width: anything thinner cannot be laid down, so it is dropped
LOGO_MIN_SHARE = 0.02   # a silhouette under 2% of its square is a speck, not a logo


def otsu(values):
    """Otsu's threshold over 0..255. The shop's preview runs the same maths
    (src/lib/qr-stand/logo-silhouette.ts) so what a customer sees is what prints."""
    hist = np.bincount(np.clip(values.astype(int), 0, 255).ravel(), minlength=256).astype(float)
    total = hist.sum()
    if total == 0:
        return 128
    sum_all = np.dot(np.arange(256), hist)
    w0 = sum0 = 0.0
    best_t, best_var = 128, -1.0
    for t in range(256):
        w0 += hist[t]
        if w0 == 0:
            continue
        w1 = total - w0
        if w1 == 0:
            break
        sum0 += t * hist[t]
        m0, m1 = sum0 / w0, (sum_all - sum0) / w1
        var = w0 * w1 * (m0 - m1) ** 2
        if var > best_var:
            best_var, best_t = var, t
    return best_t


def logo_silhouette(path):
    """The logo as a True-where-it-prints mask, cropped to its own edges.

    One colour only: the plate is white and the code is black, so a logo becomes
    the parts of it that differ from its background. Transparent pixels are
    background; on a solid image the background is whatever colour runs round
    its border. A light logo on a transparent sheet is read the other way round
    (against black), or it would vanish."""
    from PIL import Image, ImageOps
    im = ImageOps.exif_transpose(Image.open(path)).convert("RGBA")
    im.thumbnail((600, 600))
    rgba = np.asarray(im).astype(float)
    alpha = rgba[..., 3:4] / 255.0
    has_alpha = float(alpha.min()) < 0.9

    def mask_on(backdrop):
        rgb = rgba[..., :3] * alpha + backdrop * (1 - alpha)
        edge = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
        bg = backdrop if has_alpha else np.median(edge, axis=0)
        dist = np.sqrt(((rgb - bg) ** 2).sum(-1)) / math.sqrt(3)   # 0..255
        return dist > max(48, otsu(dist))

    mask = mask_on(np.array([255.0, 255.0, 255.0]))
    if has_alpha and mask.mean() < 0.01:
        mask = mask_on(np.array([0.0, 0.0, 0.0]))
    ys, xs = np.nonzero(mask)
    if not len(xs):
        raise StandError("that logo has nothing to print: use one with a clear shape", 4)
    return mask[ys.min():ys.max() + 1, xs.min():xs.max() + 1]


def logo_geometry(path, blank, cell):
    """Trace the silhouette into polygons that fill the blank square, less one
    module of quiet space so the code's own edge stays readable."""
    from PIL import Image
    bx, by, side = blank
    room = side - 2 * cell
    mask = logo_silhouette(path)
    h, w = mask.shape
    scale = room / max(h, w)                          # mm per source pixel
    wpx, hpx = max(1, round(w * scale / LOGO_RES)), max(1, round(h * scale / LOGO_RES))
    img = Image.fromarray((mask * 255).astype(np.uint8)).resize((wpx, hpx), Image.LANCZOS)
    grid = np.asarray(img) > 127
    ox = bx + (side - wpx * LOGO_RES) / 2
    top = by + (side + hpx * LOGO_RES) / 2
    runs = []
    for r in range(hpx):
        row = grid[r]
        if not row.any():
            continue
        edges = np.flatnonzero(np.diff(np.concatenate([[0], row.astype(np.int8), [0]])))
        # Both edges from the integer row, so neighbouring rows share an EXACT edge;
        # (top - r*res) - res differs from top - (r+1)*res in the last bit, and the
        # seams that leaves are what the nozzle-width erosion below then eats.
        y_hi, y_lo = top - r * LOGO_RES, top - (r + 1) * LOGO_RES
        for a, b in zip(edges[::2], edges[1::2]):
            runs.append(box(ox + a * LOGO_RES, y_lo, ox + b * LOGO_RES, y_hi))
    shape = unary_union(runs).buffer(0.01, join_style=2).buffer(-0.01, join_style=2)
    half = LOGO_MIN_FEATURE / 2
    shape = shape.buffer(-half, join_style=2).buffer(half, join_style=2)   # drop what a nozzle can't draw
    shape = shape.simplify(0.04)
    share = shape.area / (room * room) if room > 0 else 0
    if shape.is_empty or share < LOGO_MIN_SHARE:
        raise StandError("that logo is too fine to print: use a bolder version of it", 4)
    return shape, share


def soft_plate():
    # body plus a stack of shrinking slabs for the rounded top edge
    parts = [to_manifold(rounded_rect(PW, PH, PR), 0, PT - EDGE_R)]
    steps = 8
    for i in range(steps):
        z0 = PT - EDGE_R + EDGE_R * i / steps
        z1 = PT - EDGE_R + EDGE_R * (i + 1) / steps
        h = (z1 - (PT - EDGE_R))
        inset = EDGE_R - math.sqrt(max(0.0, EDGE_R ** 2 - h ** 2))
        slab = affinity.translate(rounded_rect(PW - 2 * inset, PH - 2 * inset, max(0.5, PR - inset)), inset, inset)
        parts.append(to_manifold(slab, z0, z1))
    return m3d.Manifold.batch_boolean(parts, m3d.OpType.Add)


def hook_pockets():
    # Slot open on the back for the hook to drop in, plus a hidden channel above it
    # behind a LEDGE-thick skin. Slide the leg up LIP_L and the lips lock behind it;
    # standing on the table, the leg can't drop back down, so it stays locked.
    cx, w = PW / 2, SLOT_W
    out = []
    for a in HOOKS:
        lo = a - LIP_L - CLEAR
        open_hi = a + STEM_L + CLEAR
        chan_hi = a + STEM_L + LIP_L + CLEAR
        out.append(to_manifold(box(cx - w / 2, lo, cx + w / 2, open_hi), -1, HOOK_D + CLEAR))
        out.append(to_manifold(box(cx - w / 2, lo, cx + w / 2, chan_hi), LEDGE - CLEAR, HOOK_D + CLEAR))
    return m3d.Manifold.batch_boolean(out, m3d.OpType.Add)


def build_plate(url, text, logo=None, size=QR_SIZE, top=QR_TOP, full=False, clear_bottom=0.0):
    if full and logo:
        raise StandError("a full code has no centre square for a logo", 1)
    if size + top > PH:
        raise StandError("the code does not fit on the plate", 1)
    qr_poly, qr, blank, mat = qr_geometry(url, size, top, full)   # first: a refused link costs no geometry
    feats = qr_poly.union(text_geometry(text)) if text else qr_poly
    logo_share = None
    if logo:
        logo_poly, logo_share = logo_geometry(logo, blank, size / mat.shape[0])
        feats = feats.union(logo_poly)
    if clear_bottom and feats.bounds[1] < clear_bottom:
        # The bottom of the face is kept empty for something stuck on (a nameplate).
        raise StandError(f"the face reaches {feats.bounds[1]:.1f} mm from the bottom; "
                         f"{clear_bottom:.1f} mm must stay clear", 1)
    plate = soft_plate() - hook_pockets()
    plate = plate + to_manifold(feats, PT - 0.01, PT + RAISE)
    return plate, qr, blank, mat, logo_share


def build_leg():
    # 2D in the leg plane: x = depth into the plate (hooks at x<0), y up the contact edge.
    a = math.radians(90 - LEAN)
    tip = (LEG_FOOT * math.sin(a), LEG_FOOT * math.cos(a))    # end of the table edge
    body = Polygon([(0, 0), tip, (LEG_TOP_W, LEG_LEN), (0, LEG_LEN)])
    body = body.buffer(-1.0, join_style=1).buffer(1.0, join_style=1)
    hooks = []
    for y in HOOKS:
        stem = box(-HOOK_D, y, 0.5, y + STEM_L)
        # Only the leg changed when the fit was tightened (2026-10-30), so a new leg fits an older plate.
        face = -(LEDGE - CLEAR + LIP_FIT)
        lip = Polygon([(-HOOK_D, y + STEM_L - 0.1), (face, y + STEM_L - 0.1),
                       (face, y + STEM_L + LIP_L - 1.0), (face - 1.0, y + STEM_L + LIP_L),
                       (-HOOK_D, y + STEM_L + LIP_L)])
        hooks += [stem, lip]
    return to_manifold(unary_union([body] + hooks), 0, LEG_T)


def assemble(url, text, logo=None, **face):
    plate, qr, blank, mat, logo_share = build_plate(url, text, logo, **face)
    leg = build_leg().translate([PW + 10 + HOOK_D, 2, 0])
    whole = plate + leg
    m = whole.to_mesh()
    V = np.asarray(m.vert_properties)[:, :3].astype(float)
    F = np.asarray(m.tri_verts).astype(int)
    zc = V[F][:, :, 2]
    black = (zc.max(1) > PT + 0.05) & (zc.min(1) >= PT - 0.02)  # raised QR + text + logo faces
    return V, F, black, qr, blank, mat, logo_share


def face_change_z():
    """The layer the face colour starts on: the first one wholly above the plate.

    A filament change in a Bambu project is keyed to a layer's TOP and applies to
    that layer, so keying it to the plate's own top (6.0) would print the plate's
    last layer black under the whole face. 6.2 is the first raised layer."""
    n = math.ceil(round((PT - LAYER_FIRST) / LAYER, 6))
    return round(LAYER_FIRST + (n + 1) * LAYER, 3)


def face_change_xml():
    """The face colour as a height band. Everything above the plate is raised
    artwork, so one filament change at the first raised layer prints the code,
    caption and logo black on a white plate. Proven on the 2.1 command line
    2026-10-18: filament 1 for layers 0-29, filament 2 for 30-34."""
    return ('<?xml version="1.0" encoding="utf-8"?>\n<custom_gcodes_per_layer>\n<plate>\n<plate_info id="1"/>\n'
            f'<layer top_z="{face_change_z()}" type="2" extruder="{FACE_FILAMENT}" color="{FACE_COLOUR}" extra="" gcode="tool_change"/>\n'
            '</plate>\n</custom_gcodes_per_layer>\n')


# The slicer on Earth is the 2.1 command line, and it refuses a file stamped by a
# newer app ("File Version 2.8.2.61 not supported by current cli version
# 02.01.01.52"). An older stamp opens in every newer app, so stamp the oldest.
APP_VERSION = "02.01.01.52"
# The wrapper's settings were saved by the 2.8 desktop app, where these use -1/0
# for "inherit". The 2.1 command line range-checks them and refuses the whole
# file, so they are written as the plain values 2.1 means by default.
CLI_SAFE = {"raft_first_layer_expansion": "2", "solid_infill_filament": "1", "sparse_infill_filament": "1",
            "tree_support_wall_count": "0", "wall_filament": "1"}


def project_settings():
    with open(os.path.join(WRAPPER, "Metadata/project_settings.config"), encoding="utf-8") as f:
        s = json.load(f)
    s.update(CLI_SAFE)
    return json.dumps(s, indent=4)


def write_3mf(V, F, black, out, title, paint=False, layers_xml=None):
    c = (V.min(0) + V.max(0)) / 2
    Vc = V - c
    ext = V.max(0) - V.min(0)
    verts = "\n".join(f'     <vertex x="{x:.4f}" y="{y:.4f}" z="{z:.4f}"/>' for x, y, z in Vc)
    # The face colour is the height band in custom_gcode_per_layer.xml. Painting the
    # triangles as well makes the slicer bleed black into the plate under every
    # module. Sliced 2026-10-18 on the 2.1 CLI: paint + band = 6 filament loads,
    # 1 h 53 m, 51.98 g; band only = 2 loads, 1 h 43 m, 50.79 g, the same face.
    # --paint keeps it for opening the file in the desktop app.
    tris = "\n".join(
        f'     <triangle v1="{a}" v2="{b}" v3="{cc}"' + (f' paint_color="{"8" if k else "4"}"' if paint else "") + "/>"
        for (a, b, cc), k in zip(F, black))
    ns = ('xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" '
          'xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" '
          'xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p"')
    obj = (f'<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" {ns}>\n'
           f' <metadata name="BambuStudio:3mfVersion">1</metadata>\n <resources>\n'
           f'  <object id="1" p:UUID="{uuid.uuid4()}" type="model">\n   <mesh>\n    <vertices>\n{verts}\n    </vertices>\n'
           f'    <triangles>\n{tris}\n    </triangles>\n   </mesh>\n  </object>\n </resources>\n <build/>\n</model>\n')
    bx, by, hz = 128.0, 85.0, ext[2] / 2   # low on the bed, clear of the purge tower at y~187
    top = (f'<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" {ns}>\n'
           f' <metadata name="Application">BambuStudio-{APP_VERSION}</metadata>\n'
           f' <metadata name="BambuStudio:3mfVersion">1</metadata>\n'
           f' <metadata name="Designer">Imagine This Printed</metadata>\n'
           f' <metadata name="Title">{title}</metadata>\n <resources>\n'
           f'  <object id="2" p:UUID="{uuid.uuid4()}" type="model">\n   <components>\n'
           f'    <component p:path="/3D/Objects/object_1.model" objectid="1" p:UUID="{uuid.uuid4()}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>\n'
           f'   </components>\n  </object>\n </resources>\n <build p:UUID="{uuid.uuid4()}">\n'
           f'  <item objectid="2" p:UUID="{uuid.uuid4()}" transform="1 0 0 0 1 0 0 0 1 {bx} {by} {hz:.4f}" printable="1"/>\n'
           f' </build>\n</model>\n')
    settings = (f'<?xml version="1.0" encoding="UTF-8"?>\n<config>\n  <object id="2">\n'
                f'    <metadata key="name" value="{title}"/>\n    <metadata key="extruder" value="1"/>\n'
                f'    <part id="1" subtype="normal_part">\n      <metadata key="name" value="{title}"/>\n'
                f'      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>\n    </part>\n  </object>\n'
                f'  <plate>\n    <metadata key="plater_id" value="1"/>\n    <metadata key="plater_name" value="Plate 1"/>\n'
                f'    <metadata key="locked" value="false"/>\n    <model_instance>\n      <metadata key="object_id" value="2"/>\n'
                f'      <metadata key="instance_id" value="0"/>\n      <metadata key="identify_id" value="95"/>\n    </model_instance>\n  </plate>\n'
                f'  <assemble>\n   <assemble_item object_id="2" instance_id="0" transform="1 0 0 0 1 0 0 0 1 {bx} {by} {hz:.4f}" offset="0 0 0" />\n  </assemble>\n</config>\n')
    rels = ('<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n'
            ' <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n</Relationships>\n')
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(os.path.join(WRAPPER, "[Content_Types].xml"), "[Content_Types].xml")
        z.writestr("_rels/.rels", rels)
        z.writestr("3D/3dmodel.model", top)
        z.write(os.path.join(WRAPPER, "3D/_rels/3dmodel.model.rels"), "3D/_rels/3dmodel.model.rels")
        z.writestr("3D/Objects/object_1.model", obj)
        z.writestr("Metadata/model_settings.config", settings)
        z.writestr("Metadata/project_settings.config", project_settings())
        with open(os.path.join(WRAPPER, "Metadata/slice_info.config"), encoding="utf-8") as f:
            z.writestr("Metadata/slice_info.config", re.sub(r"\d\d\.\d\d\.\d\d\.\d\d", APP_VERSION, f.read()))
        z.writestr("Metadata/custom_gcode_per_layer.xml", layers_xml or face_change_xml())
    return ext


def render_front(V, F, black, path, px=10, w=PW, h=PH):
    """Top-down picture of the plate face (what a phone camera sees) for decode checks."""
    from PIL import Image, ImageDraw
    PW, PH = w, h   # the keychain renders its own, smaller face
    img = Image.new("L", (int(PW * px) + 80, int(PH * px) + 80), 235)
    d = ImageDraw.Draw(img)
    tri = V[F]
    order = np.argsort(tri[:, :, 2].max(1))
    for i in order:
        t = tri[i]
        if t[:, 0].max() > PW + 1:  # skip the leg
            continue
        n = np.cross(t[1] - t[0], t[2] - t[0])
        if n[2] <= 1e-9:
            continue
        pts = [(40 + x * px, 40 + (PH - y) * px) for x, y, _ in t]
        d.polygon(pts, fill=25 if black[i] else 250)
    img.save(path)


def scan_check(png, url):
    """Read the face picture back the way a phone would and compare it to the link.
    Returns (ok, texts). zxing-cpp first; zbar (pyzbar) as a second opinion when
    it is installed, since the two decoders fail on different things."""
    from PIL import Image
    img = Image.open(png)
    texts = []
    try:
        import zxingcpp
        texts += [r.text for r in zxingcpp.read_barcodes(img)]
    except ImportError:
        pass
    if url not in texts:
        try:
            from pyzbar.pyzbar import decode
            texts += [d.data.decode("utf-8", "replace") for d in decode(img)]
        except ImportError:
            pass
    return url in texts, texts


def make(url, text, out, title="QR Stand", logo=None, check=True, paint=False, **face):
    V, F, black, qr, blank, mat, logo_share = assemble(url, text, logo, **face)
    mesh = trimesh.Trimesh(V, F, process=False)
    png = os.path.splitext(out)[0] + "-face.png"
    render_front(V, F, black, png)
    result = {"qr_version": qr.version, "qr_error": qr.error, "modules": mat.shape[0], "blank_mm": round(blank[2], 1),
              "logo": "printed" if logo else "blank", "logo_share": round(logo_share, 3) if logo else None,
              "face_change_mm": face_change_z(), "watertight": bool(mesh.is_watertight),
              "volume_cm3": round(mesh.volume / 1000, 1), "face_png": png, "out": out}
    if check:
        ok, texts = scan_check(png, url)
        result.update(scan_ok=ok, scan_text=texts)
        if not ok:
            # No 3mf is written for a face that does not read back.
            raise StandError("the code did not scan back", 3)
    ext = write_3mf(V, F, black, out, title, paint)
    result["size_mm"] = [round(e, 1) for e in ext]
    return result


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--text", default="Scan Me")
    ap.add_argument("--out", required=True)
    ap.add_argument("--title", default="QR Stand")
    ap.add_argument("--logo", help="png/jpg printed in the centre square; omit to leave it blank for a sticker")
    ap.add_argument("--no-check", action="store_true", help="skip the scan-back (never for anything that prints)")
    ap.add_argument("--paint", action="store_true", help="also paint the triangles, for opening in the desktop app")
    ap.add_argument("--full-qr", action="store_true", help="the whole code, no blank centre square (no logo)")
    ap.add_argument("--qr-size", type=float, default=QR_SIZE, help="code edge length, mm")
    ap.add_argument("--qr-top", type=float, default=QR_TOP, help="code margin from the top edge, mm")
    ap.add_argument("--clear-bottom", type=float, default=0.0,
                    help="mm at the bottom of the face that must stay empty (e.g. 50.8 for a nameplate)")
    a = ap.parse_args()
    try:
        print(json.dumps(make(a.url, a.text, a.out, a.title, a.logo, check=not a.no_check, paint=a.paint,
                              size=a.qr_size, top=a.qr_top, full=a.full_qr, clear_bottom=a.clear_bottom)))
    except StandError as e:
        print(json.dumps({"error": str(e), "code": e.code}))
        sys.exit(e.code)
