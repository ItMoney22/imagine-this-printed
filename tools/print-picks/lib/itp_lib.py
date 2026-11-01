"""Shared geometry + Blender helpers for the ITP print picks.

2D work is done in shapely (exact offsets, unions, island checks), solids in
manifold3d (booleans that are watertight by construction), and Blender is used
for the 3D-Print-Toolbox-style check, the .blend, and the renders. Text comes
from OFL fonts shaped with HarfBuzz, overlaps removed with skia-pathops, so a
customer's name is real type, not a texture.

Python deps live in ~/opt/itp-pylib (pip --target, Blender's python 3.13):
  shapely manifold3d fonttools uharfbuzz skia-pathops
"""
import os, sys, math, struct
PYLIB = os.path.expanduser("~/opt/itp-pylib")
if PYLIB not in sys.path:
    sys.path.append(PYLIB)

import numpy as np
import shapely
from shapely.geometry import Polygon, MultiPolygon, LineString, Point, box
from shapely.ops import unary_union, nearest_points
from shapely import affinity
import manifold3d as m3d

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(os.path.dirname(HERE), "fonts")

# ---------------------------------------------------------------- text -----

_font_cache = {}


def _load_font(path, wght):
    key = (path, wght)
    if key in _font_cache:
        return _font_cache[key]
    from fontTools.ttLib import TTFont
    from fontTools.ttLib.removeOverlaps import removeOverlaps
    f = TTFont(path)
    if "fvar" in f and wght is not None:
        from fontTools.varLib.instancer import instantiateVariableFont
        axes = {a.axisTag: a.defaultValue for a in f["fvar"].axes}
        axes["wght"] = wght
        f = instantiateVariableFont(f, axes)
    removeOverlaps(f)
    _font_cache[key] = f
    return f


class _FlatPen:
    """Collects glyph contours as flattened point lists (font units)."""

    def __init__(self, steps=10):
        from fontTools.pens.basePen import BasePen
        outer = self

        class P(BasePen):
            def _moveTo(s, p):
                outer.cur = [p]

            def _lineTo(s, p):
                outer.cur.append(p)

            def _curveToOne(s, a, b, c):
                p0 = outer.cur[-1]
                for i in range(1, steps + 1):
                    t = i / steps
                    mt = 1 - t
                    outer.cur.append((mt**3 * p0[0] + 3 * mt * mt * t * a[0] + 3 * mt * t * t * b[0] + t**3 * c[0],
                                      mt**3 * p0[1] + 3 * mt * mt * t * a[1] + 3 * mt * t * t * b[1] + t**3 * c[1]))

            def _qCurveToOne(s, a, b):
                p0 = outer.cur[-1]
                for i in range(1, steps + 1):
                    t = i / steps
                    mt = 1 - t
                    outer.cur.append((mt * mt * p0[0] + 2 * mt * t * a[0] + t * t * b[0],
                                      mt * mt * p0[1] + 2 * mt * t * a[1] + t * t * b[1]))

            def _closePath(s):
                if outer.cur and len(outer.cur) > 2:
                    outer.contours.append(outer.cur)
                outer.cur = []

            _endPath = _closePath

        self.contours, self.cur = [], []
        self.pen = P(None)


def text_shape(text, font_file, cap_mm=None, em_mm=None, wght=None, tracking=0.0, steps=10):
    """Return shapely geometry of `text` in mm. Baseline at y=0, starts at x=0.

    Size by cap height (cap_mm) or by em (em_mm). tracking is extra mm per glyph.
    """
    import uharfbuzz as hb
    path = font_file if os.path.isabs(font_file) else os.path.join(FONTS, font_file)
    tt = _load_font(path, wght)
    upem = tt["head"].unitsPerEm
    if cap_mm is not None:
        cap = getattr(tt["OS/2"], "sCapHeight", 0) or upem * 0.7
        scale = cap_mm / cap
    else:
        scale = em_mm / upem
    blob = hb.Blob.from_file_path(path)
    face = hb.Face(blob)
    font = hb.Font(face)
    if wght is not None and "fvar" in TTFontAxes(path):
        font.set_variations({"wght": wght})
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(font, buf, {"kern": True, "liga": True, "calt": True})
    order = tt.getGlyphOrder()
    gs = tt.getGlyphSet()
    x = 0.0
    shapes = []
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        name = order[info.codepoint]
        pen = _FlatPen(steps)
        gs[name].draw(pen.pen)
        ox, oy = x + pos.x_offset, pos.y_offset
        g = None
        for c in pen.contours:
            pts = [((px + ox) * scale, (py + oy) * scale) for px, py in c]
            if len(pts) < 3:
                continue
            poly = Polygon(pts).buffer(0)
            g = poly if g is None else g.symmetric_difference(poly)  # overlaps removed -> even-odd is exact
        if g is not None and not g.is_empty:
            shapes.append(g)
        x += pos.x_advance + tracking / scale
    return unary_union(shapes) if shapes else Polygon()


def TTFontAxes(path):
    from fontTools.ttLib import TTFont
    f = TTFont(path, lazy=True)
    return {a.axisTag for a in f["fvar"].axes} if "fvar" in f else set()


def fit_center(geom, cx, cy, max_w=None, max_h=None):
    """Scale geom uniformly to fit max_w/max_h (only shrinks/grows to fit) and center at (cx,cy)."""
    minx, miny, maxx, maxy = geom.bounds
    w, h = maxx - minx, maxy - miny
    s = 1e9
    if max_w:
        s = min(s, max_w / w)
    if max_h:
        s = min(s, max_h / h)
    if s == 1e9:
        s = 1.0
    g = affinity.scale(geom, s, s, origin=(minx, miny))
    minx, miny, maxx, maxy = g.bounds
    return affinity.translate(g, cx - (minx + maxx) / 2, cy - (miny + maxy) / 2), s


def center_on(geom, cx, cy):
    minx, miny, maxx, maxy = geom.bounds
    return affinity.translate(geom, cx - (minx + maxx) / 2, cy - (miny + maxy) / 2)


# ----------------------------------------------------- 2D print checks -----

def thin_report(geom, width):
    """Regions of geom narrower than `width` (morphological opening).

    Returns (total_area, largest_piece_area). Sharp outside corners always lose a
    sliver of about (1 - pi/4) * (width/2)^2, so judge on the largest piece.
    """
    if geom.is_empty:
        return 0.0, 0.0
    opened = geom.buffer(-width / 2, quad_segs=8).buffer(width / 2 + 1e-3, quad_segs=8)
    thin = geom.difference(opened)
    pieces = list(getattr(thin, "geoms", [thin])) if not thin.is_empty else []
    pieces = [p for p in pieces if p.area > 0]
    return thin.area, max((p.area for p in pieces), default=0.0)


def components(geom):
    if geom.is_empty:
        return []
    return list(geom.geoms) if hasattr(geom, "geoms") else [geom]


def bridge(a_pt, b_pt, width, overlap=0.4):
    """A straight bar from a_pt to b_pt, `width` wide, pushed `overlap` mm into both ends."""
    line = LineString([a_pt, b_pt])
    if line.length < 1e-6:
        return Point(a_pt).buffer(width / 2)
    dx, dy = (b_pt[0] - a_pt[0]) / line.length, (b_pt[1] - a_pt[1]) / line.length
    a = (a_pt[0] - dx * overlap, a_pt[1] - dy * overlap)
    b = (b_pt[0] + dx * overlap, b_pt[1] + dy * overlap)
    return LineString([a, b]).buffer(width / 2, cap_style="flat")


def connect_islands(geom, anchor, width, prefer_vertical=False, log=None):
    """Bridge every component of geom that does not touch `anchor` to the nearest
    anchored material, until nothing floats. Returns (geom_with_bridges, bridges)."""
    bars = []
    anchor = anchor.buffer(0)
    for _ in range(200):
        parts = components(unary_union([geom, anchor]))
        anchored = [p for p in parts if p.intersects(anchor)]
        floating = [p for p in parts if not p.intersects(anchor)]
        if not floating:
            break
        solid = unary_union(anchored)
        best = None
        for f in floating:
            # candidate bridge: nearest points to any anchored material
            a, b = nearest_points(f, solid)
            d = a.distance(b)
            if prefer_vertical:
                # also try a straight-down or straight-up bar from the island's lowest/highest point
                for y_end in (f.bounds[1], f.bounds[3]):
                    pass
            if best is None or d < best[0]:
                best = (d, a, b, f)
        d, a, b, f = best
        bar = bridge((a.x, a.y), (b.x, b.y), width)
        bars.append(bar)
        if log is not None:
            log.append(f"bridge {d:.2f} mm from island at ({f.centroid.x:.1f},{f.centroid.y:.1f})")
        geom = unary_union([geom, bar])
    return geom, bars


# ------------------------------------------------------------- solids -----

def _rings(poly):
    out = [np.asarray(poly.exterior.coords)[:-1]]
    for r in poly.interiors:
        out.append(np.asarray(r.coords)[:-1])
    return out


def clean2d(geom, tol=0.004):
    """Drop collinear/near-duplicate points: they triangulate into zero-area slivers,
    which the print checker counts as degenerate and as intersecting faces."""
    g = shapely.set_precision(geom.simplify(tol), 0.0005)
    return g.buffer(0)


def cross_section(geom):
    geom = clean2d(geom)
    rings = []
    for p in components(geom):
        if p.geom_type == "Polygon" and p.area > 1e-6:
            rings += _rings(p)
    return m3d.CrossSection(rings, m3d.FillRule.EvenOdd)


def extrude(geom, z0, z1):
    """Prism of a shapely shape from z0 to z1 (mm)."""
    if geom.is_empty:
        return m3d.Manifold()
    m = m3d.Manifold.extrude(cross_section(geom), z1 - z0).translate((0, 0, z0))
    return m


def chamfered_extrude(geom, z0, z1, top_inset):
    """Prism with a 45-ish degree chamfer at the top (inset `top_inset` over its last `top_inset` mm)."""
    h = z1 - z0
    if top_inset <= 0 or top_inset >= h:
        return extrude(geom, z0, z1)
    body = extrude(geom, z0, z1 - top_inset)
    cs = cross_section(geom)
    inner = geom.buffer(-top_inset, join_style="round")
    if inner.is_empty:
        return body
    scale_fn = None
    # Hull of bottom outline and inset outline per component approximates a chamfer
    caps = []
    for p in components(geom):
        ip = p.buffer(-top_inset, join_style="round")
        if ip.is_empty:
            continue
        lo = extrude(p, z1 - top_inset, z1 - top_inset + 0.01)
        hi = extrude(ip, z1 - 0.01, z1)
        caps.append(m3d.Manifold.batch_hull([lo, hi]) if p.convex_hull.equals(p) else extrude(ip, z1 - top_inset, z1))
    return m3d.Manifold.batch_boolean([body] + caps, m3d.OpType.Add)


def union(ms):
    ms = [m for m in ms if not m.is_empty()]
    if not ms:
        return m3d.Manifold()
    return m3d.Manifold.batch_boolean(ms, m3d.OpType.Add)


def mesh_arrays(man):
    try:
        man = man.simplify(1e-4)  # merges sliver triangles without moving the surface
    except Exception:
        pass
    mesh = man.to_mesh()
    v = np.asarray(mesh.vert_properties)[:, :3].astype(np.float64)
    t = np.asarray(mesh.tri_verts).astype(np.int64)
    return v, t


def clean_arrays(man, dist=0.002):
    """Collapse near-zero-length edges (revolve/clip slivers) with bmesh, keeping it
    closed. Blender only. Returns (verts, tris)."""
    import bmesh
    v, t = mesh_arrays(man)
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in v.tolist()]
    for a, b, c in t.tolist():
        try:
            bm.faces.new((vs[a], vs[b], vs[c]))
        except ValueError:
            pass
    bmesh.ops.dissolve_degenerate(bm, dist=dist, edges=bm.edges[:])
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.verts.index_update()
    v2 = np.array([vv.co[:] for vv in bm.verts])
    t2 = np.array([[vv.index for vv in f.verts] for f in bm.faces])
    bm.free()
    return v2, t2


def write_stl(man, path, clean=False):
    v, t = clean_arrays(man) if clean else mesh_arrays(man)
    tri = v[t]
    n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    ln = np.linalg.norm(n, axis=1, keepdims=True)
    n = n / np.where(ln == 0, 1, ln)
    with open(path, "wb") as f:
        f.write(b"ITP print pick".ljust(80, b" "))
        f.write(struct.pack("<I", len(t)))
        rec = np.zeros(len(t), dtype=[("n", "<f4", 3), ("v", "<f4", 9), ("a", "<u2")])
        rec["n"] = n
        rec["v"] = tri.reshape(-1, 9)
        f.write(rec.tobytes())


def overlap_volume(a, b):
    return (a ^ b).volume()


# ------------------------------------------------------------ blender -----

def bl_mesh(name, man, color=None, rough=0.45, coll=None, sheen=False, clean=False):
    import bpy
    v, t = clean_arrays(man) if clean else mesh_arrays(man)
    me = bpy.data.meshes.new(name)
    me.from_pydata(v.tolist(), [], t.tolist())
    me.validate()
    me.update()
    ob = bpy.data.objects.new(name, me)
    (coll or bpy.context.scene.collection).objects.link(ob)
    if color is not None:
        mat = bpy.data.materials.new(name + "_mat")
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        r, g, b = hex_lin(color)
        bsdf.inputs["Base Color"].default_value = (r, g, b, 1)
        bsdf.inputs["Roughness"].default_value = rough
        try:
            bsdf.inputs["Specular IOR Level"].default_value = 0.35
        except KeyError:
            pass
        me.materials.append(mat)
    # mm in, scene in metres: keep geometry in mm and scale the object
    ob.scale = (0.001, 0.001, 0.001)
    return ob


def hex_lin(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def print3d_check(ob):
    """The 3D-Print Toolbox's own checks (non-manifold edges, intersecting faces,
    degenerate faces), done the way the toolbox does them: bmesh + BVH overlap."""
    import bmesh
    from mathutils.bvhtree import BVHTree
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    non_manifold = sum(1 for e in bm.edges if not e.is_manifold)
    bad_contig = sum(1 for e in bm.edges if e.is_manifold and not e.is_contiguous)
    degenerate = sum(1 for f in bm.faces if f.calc_area() < 1e-8)
    tree = BVHTree.FromBMesh(bm, epsilon=0.00001)
    inter = len({i for pair in tree.overlap(tree) for i in pair})
    bm.free()
    return {"non_manifold_edges": non_manifold, "bad_contiguous_edges": bad_contig,
            "intersecting_faces": inter, "degenerate_faces": degenerate}


def reset_scene():
    import bpy
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = "METRIC"
    sc.unit_settings.scale_length = 1.0
    return sc


def setup_render(res=1600, res_y=None, samples=160, exposure=0.0, look="AgX - Medium High Contrast"):
    import bpy
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for kind in ("OPTIX", "CUDA"):
        try:
            prefs.compute_device_type = kind
            prefs.get_devices()
            devs = [d for d in prefs.devices if d.type == kind]
            if devs:
                for d in prefs.devices:
                    d.use = d.type == kind
                sc.cycles.device = "GPU"
                break
        except Exception:
            continue
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.render.resolution_x = res
    sc.render.resolution_y = res_y or res
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "AgX"
    try:
        sc.view_settings.look = look
    except TypeError:
        pass
    sc.view_settings.exposure = exposure
    return sc


def add_world(color=(0.05, 0.05, 0.05), strength=1.0):
    import bpy
    w = bpy.data.worlds.new("World")
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (*color, 1)
    bg.inputs[1].default_value = strength
    bpy.context.scene.world = w
    return w


def add_light(kind, loc, energy, size=0.1, color=(1, 1, 1), rot=None, name=None):
    import bpy
    ld = bpy.data.lights.new(name or kind, kind)
    ld.energy = energy
    ld.color = color
    if kind == "AREA":
        ld.size = size
    elif kind in ("POINT", "SPOT"):
        ld.shadow_soft_size = size
    ob = bpy.data.objects.new(name or kind, ld)
    ob.location = loc
    if rot:
        ob.rotation_euler = rot
    bpy.context.scene.collection.objects.link(ob)
    return ob


def look_at(ob, target):
    from mathutils import Vector
    d = Vector(target) - ob.location
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def add_camera(loc, target, lens=50, dof_target=None, fstop=4.0):
    import bpy
    cd = bpy.data.cameras.new("Camera")
    cd.lens = lens
    cd.clip_start = 0.001
    ob = bpy.data.objects.new("Camera", cd)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    look_at(ob, target)
    bpy.context.scene.camera = ob
    if dof_target is not None:
        cd.dof.use_dof = True
        cd.dof.focus_distance = (ob.location - __import__("mathutils").Vector(dof_target)).length
        cd.dof.aperture_fstop = fstop
    return ob


def add_plane(name, size, loc, rot=(0, 0, 0), color=(0.8, 0.8, 0.8), rough=0.6):
    import bpy
    bpy.ops.mesh.primitive_plane_add(size=size, location=loc, rotation=rot)
    ob = bpy.context.active_object
    ob.name = name
    mat = bpy.data.materials.new(name + "_mat")
    mat.use_nodes = True
    b = mat.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    ob.data.materials.append(mat)
    return ob


def render(path):
    import bpy
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def add_bokeh(n, center, spread, z_range, radius=0.006, strength=30.0, seed=3, colors=((1.0, 0.72, 0.38),)):
    """Out-of-focus fairy lights behind a product (small emissive spheres)."""
    import bpy, random
    rnd = random.Random(seed)
    mats = []
    for i, c in enumerate(colors):
        m = bpy.data.materials.new(f"bulb{i}")
        m.use_nodes = True
        nt = m.node_tree
        for nd in list(nt.nodes):
            nt.nodes.remove(nd)
        em = nt.nodes.new("ShaderNodeEmission")
        em.inputs[0].default_value = (*c, 1)
        em.inputs[1].default_value = strength
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        nt.links.new(em.outputs[0], out.inputs[0])
        mats.append(m)
    for i in range(n):
        x = center[0] + rnd.uniform(-spread[0], spread[0])
        y = center[1] + rnd.uniform(-spread[1], spread[1])
        z = rnd.uniform(*z_range)
        bpy.ops.mesh.primitive_uv_sphere_add(radius=radius * rnd.uniform(0.7, 1.2), location=(x, y, z), segments=12, ring_count=8)
        bpy.context.active_object.data.materials.append(rnd.choice(mats))


def overhang_report(man, limit_deg=45.0, bed_eps=0.05):
    """Downward-facing area steeper than `limit_deg` from vertical, ignoring the bed face.

    A face overhangs when its normal points down more than (90 - limit) degrees below
    horizontal, i.e. n_z < -sin(90 - limit) = -cos(limit). Returns (area_mm2, worst_deg_from_vertical, lowest_z)."""
    v, t = mesh_arrays(man)
    tri = v[t]
    n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    a = np.linalg.norm(n, axis=1)
    ok = a > 1e-12
    n = n[ok] / a[ok, None]
    area = a[ok] / 2
    zmin = tri[ok][:, :, 2].min(axis=1)
    off_bed = zmin > bed_eps
    thr = -math.cos(math.radians(limit_deg))
    bad = (n[:, 2] < thr) & off_bed
    if not bad.any():
        return 0.0, 0.0, None
    worst = math.degrees(math.acos(min(1.0, -n[bad, 2].min())))
    return float(area[bad].sum()), 90.0 - worst, float(zmin[bad].min())
