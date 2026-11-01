#!/usr/bin/env python3
"""Fit-test coupons for the ITP print picks: print the fitted features small before a whole product.

usage: ~/.local/share/itp-print-check/venv/bin/python fit_coupons.py mx <outdir>
       ~/.local/share/itp-print-check/venv/bin/python fit_coupons.py marker <outdir> [--marker 17.5 --magnet 20x3]

Every coupon shows three sizes side by side: one step tight, the size the product uses, one step loose.
Raised dots count them: 1 dot = tight, 2 dots = the product's size, 3 dots = loose. If 2 fits, print the
product. If only 3 fits, the printer runs tight: tell the modeller and bump the product's clearance by one step.
"""
import os, sys
import numpy as np
import trimesh
from shapely.geometry import Point, box
from shapely.ops import unary_union


def ext(poly, z0, z1):
    polys = list(poly.geoms) if hasattr(poly, "geoms") else [poly]
    ms = []
    for p in polys:
        m = trimesh.creation.extrude_polygon(p.simplify(0.005), z1 - z0)
        m.merge_vertices()
        m.apply_translation([0, 0, z0])
        ms.append(m)
    return trimesh.util.concatenate(ms)


def dots(n, x, y, r=0.6, gap=1.8):
    return unary_union([Point(x + (i - (n - 1) / 2) * gap, y).buffer(r, quad_segs=16) for i in range(n)])


def save(parts, outdir, name):
    # one watertight solid: overlapping shells in one STL are left to the slicer's mercy otherwise
    m = trimesh.boolean.union(parts, engine="manifold")
    assert m.is_watertight, name
    path = os.path.join(outdir, name)
    m.export(path)
    return path


def mx(outdir, hole=14.0, step=0.1, plate=1.5, cross=(4.15, 1.35), stem_d=5.6, cross_depth=4.0):
    """MX socket strip + keycap-stem cross test, matching make_name_clicker.py's HOLE / CROSS_L / CROSS_W."""
    os.makedirs(outdir, exist_ok=True)
    out = {}
    # socket strip: 1.5 mm plate where the switch clips catch, 3 mm rim at the long edges for stiffness,
    # kept 1.6 mm clear of every hole so the clips can spring (MX wants 16.2 mm under a 14 mm hole)
    pitch = 19.05
    holes = [hole - step, hole, hole + step]
    W, Lg = 24.0, pitch * 3 + 4
    xs = [(i - 1) * pitch for i in range(3)]
    sq = unary_union([box(x - h / 2, -h / 2, x + h / 2, h / 2) for x, h in zip(xs, holes)])
    plate2d = box(-Lg / 2, -W / 2, Lg / 2, W / 2).difference(sq)
    rim = box(-Lg / 2, -W / 2, Lg / 2, W / 2).difference(box(-Lg / 2 + 1.0, -W / 2 + 2.4, Lg / 2 - 1.0, W / 2 - 2.4))
    parts = [ext(plate2d, 0, plate), ext(rim, 0, 3.0)]
    for i, x in enumerate(xs):
        parts.append(ext(dots(i + 1, x, W / 2 - 1.2), 3.0, 3.6))
    out["mx_socket_strip.stl"] = save(parts, outdir, "mx_socket_strip.stl")
    # stems: printed mouth-down on the bed exactly like the caps are, so the first-layer squish is tested too
    L0, W0 = cross
    sizes = [(L0 - step, W0 - step), (L0, W0), (L0 + step, W0 + step)]
    sx = [(i - 1) * 10.0 for i in range(3)]
    crosses = [unary_union([box(x - l / 2, -w / 2, x + l / 2, w / 2), box(x - w / 2, -l / 2, x + w / 2, l / 2)])
               for x, (l, w) in zip(sx, sizes)]
    tab = box(-15, -9, 15, 4.5).difference(unary_union(crosses))
    stems_low = unary_union([Point(x, 0).buffer(stem_d / 2, quad_segs=48) for x in sx]).difference(unary_union(crosses))
    stems_top = unary_union([Point(x, 0).buffer(stem_d / 2, quad_segs=48) for x in sx])
    parts = [ext(tab, 0, 1.0), ext(stems_low, 0, cross_depth), ext(stems_top, cross_depth, cross_depth + 1.5)]
    for i, x in enumerate(sx):
        parts.append(ext(dots(i + 1, x, -6.5, gap=1.6), 1.0, 1.6))
    out["mx_stem_cross.stl"] = save(parts, outdir, "mx_stem_cross.stl")
    return out, {"socket_holes_mm": holes, "stem_cross_mm": sizes}


def teardrop(r):
    """the marker pocket's section from make_marker_holder.py: round, with a 45-degree point toward +z,
    truncated 1 mm past the circle, so a horizontal bore prints with no support."""
    from shapely.geometry import Polygon
    k = r / 2 ** 0.5
    td = unary_union([Point(0, 0).buffer(r, quad_segs=48), Polygon([(-k, k), (0, r * 2 ** 0.5), (k, k)])])
    return td.intersection(box(-50, -50, 50, r + 1.0)).simplify(0.005)  # drops near-duplicate points that break the extrude


def marker(outdir, marker_d=18.0, magnet_d=20.0, magnet_t=3.0, peg=8.0, peg_clr=0.2):
    """Teacher marker holder fit tests, printed the way the pencil prints:
    - marker bores lying horizontal (teardrop up), for markers of d-1 / d / d+1 mm (+0.5 clearance);
    - magnet pockets open onto the bed under a bridged roof, cut d+0.1 / d+0.2 / d+0.3 x t+0.2;
    - the 8 mm diamond peg printed lying down (like on the body) and three sockets printed standing
      (like the ferrule and cone), cut with 0.1 / 0.2 / 0.3 mm clearance."""
    os.makedirs(outdir, exist_ok=True)
    out, info = {}, {}
    # marker bores: a 10 mm slice of the pencil body with three bores along y
    ds = [marker_d - 1.0, marker_d, marker_d + 1.0]
    rs = [(d + 0.5) / 2 for d in ds]
    floor, side = 1.6, 2.4
    xs, x = [], 0.0
    for r in rs:
        x += r + side
        xs.append(x)
        x += r
    W = x + side
    Hh = floor + 2 * max(rs) + 1.0 + 1.6
    import trimesh as _t
    blk = _t.creation.box((W, 10.0, Hh))
    blk.apply_translation([W / 2, 5.0, Hh / 2])
    bores = []
    for xc, r in zip(xs, rs):
        sec = teardrop(r)
        m = trimesh.creation.extrude_polygon(sec, 12.0)          # along z, then turn to run along y
        m.merge_vertices()
        m.apply_transform(trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0]))
        m.apply_translation([xc, -1.0, floor + r])
        bores.append(m)
    dotsm = [ext(dots(i + 1, xc, 1.8), Hh, Hh + 0.6) for i, xc in enumerate(xs)]
    m = trimesh.boolean.difference([blk, trimesh.boolean.union(bores, engine="manifold")], engine="manifold")
    m = trimesh.boolean.union([m] + dotsm, engine="manifold")
    assert m.is_watertight
    out["marker_bores.stl"] = os.path.join(outdir, "marker_bores.stl")
    m.export(out["marker_bores.stl"])
    info["marker_bores_mm"] = [round(2 * r, 2) for r in rs]
    # magnet pockets: open on the bed, 1.2 mm roof
    ms = [magnet_d + 0.1, magnet_d + 0.2, magnet_d + 0.3]
    pitch = max(ms) + 5
    mx = [(i - 1) * pitch for i in range(3)]
    plate = box(mx[0] - pitch / 2, -max(ms) / 2 - 2.5, mx[-1] + pitch / 2, max(ms) / 2 + 2.5)
    pk = unary_union([Point(x0, 0).buffer(d / 2, quad_segs=64) for x0, d in zip(mx, ms)])
    T = magnet_t + 0.2
    parts = [ext(plate.difference(pk), 0, T), ext(plate, T, T + 1.2)]
    for i, x0 in enumerate(mx):
        parts.append(ext(dots(i + 1, x0, 0), T + 1.2, T + 1.8))
    out["magnet_pockets.stl"] = save(parts, outdir, "magnet_pockets.stl")
    info["magnet_pockets_mm"] = [f"{d:.1f} x {T:.1f}" for d in ms]
    # body-style joint: diamond holes LYING (as in the pencil body, which prints on its back), 0.1/0.2/0.3 mm
    from shapely import affinity as _a
    h = peg / 2 * 2 ** 0.5
    clrs = [0.1, 0.2, 0.3]
    cz = h + 0.3 + 2.0
    hx = [(i - 1) * 16.0 for i in range(3)]
    blk2 = box(hx[0] - 8, 0, hx[-1] + 8, 10.0)                  # in (x, y); holes run along y, 8.4 deep
    m = ext(blk2, 0, 2 * cz)
    cut = []
    for x0, c in zip(hx, clrs):
        dh = _a.rotate(box(x0 - peg / 2 - c, cz - peg / 2 - c, x0 + peg / 2 + c, cz + peg / 2 + c), 45, origin=(x0, cz))
        mm = trimesh.creation.extrude_polygon(dh.simplify(0.005), 8.5)     # section in (x, z), extrude along y
        mm.apply_transform(np.array([[1, 0, 0, 0], [0, 0, -1, 0], [0, 1, 0, 0], [0, 0, 0, 1]], float))
        mm.apply_translation([0, 10.0 + 0.01, 0])
        cut.append(mm)
    m = trimesh.boolean.difference([m, trimesh.boolean.union(cut, engine="manifold")], engine="manifold")
    m = trimesh.boolean.union([m] + [ext(dots(i + 1, x0, 3.0), 2 * cz, 2 * cz + 0.6) for i, x0 in enumerate(hx)], engine="manifold")
    assert m.is_watertight
    out["peg_holes_lying.stl"] = os.path.join(outdir, "peg_holes_lying.stl")
    m.export(out["peg_holes_lying.stl"])
    # sockets standing up, holes opening at the top, depth 8.4 like the ferrule
    sx = [(i - 1) * 18.0 for i in range(3)]
    holes = unary_union([_a.rotate(box(x0 - peg / 2 - c, -peg / 2 - c, x0 + peg / 2 + c, peg / 2 + c), 45, origin=(x0, 0))
                         for x0, c in zip(sx, clrs)])
    blocks = unary_union([Point(x0, 0).buffer(8.5, quad_segs=48) for x0 in sx] + [box(sx[0], -3, sx[-1], 3)])
    parts = [ext(blocks, 0, 1.6), ext(blocks.difference(holes), 1.6, 10.0)]
    for i, x0 in enumerate(sx):
        parts.append(ext(dots(i + 1, x0, -10.5 + 0.0), 0, 1.2))
    tabs = unary_union([box(x0 - 4, -12, x0 + 4, -6) for x0 in sx])
    parts.append(ext(tabs, 0, 1.2))
    out["peg_sockets.stl"] = save(parts, outdir, "peg_sockets.stl")
    info["peg_socket_clearance_mm"] = clrs
    return out, info


if __name__ == "__main__":
    kind, outdir = sys.argv[1], sys.argv[2]
    if kind == "mx":
        print(mx(outdir))
    else:
        a = sys.argv[3:]
        md = float(a[a.index("--marker-d") + 1]) if "--marker-d" in a else 18.0
        mg = a[a.index("--magnet") + 1] if "--magnet" in a else "20x3"
        d, t = (float(v) for v in mg.split("x"))
        print(marker(outdir, md, d, t))
