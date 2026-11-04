#!/usr/bin/env python3
"""QR keychain with an NFC tag sealed in the middle.

  keychain.py --url https://darrellmccutchen.com --out Darrell-Keychain.3mf

A 40 x 56 mm tag, 3.6 mm thick, key-ring hole at the top, the whole code raised
in black on the front (no centre square, no words). Inside, under the code, a
26.5 mm pocket for a 25 mm round NFC tag (the size bambu-printing proved
2026-10-07). The print PAUSES with the pocket open: drop the tag in, press
resume, and the next layers close over it. NFC reads through the 2 mm of PLA.

Same exit codes and one-line JSON as gen.py; reuses its code, scan check and
A1 project settings.
"""
import argparse, json, os, sys
import numpy as np, trimesh
from shapely.geometry import Point
from shapely import affinity
import gen

KW, KH, KT, KR = 40.0, 56.0, 3.6, 4.0          # width, height, body thickness, corner radius
HOLE_D, HOLE_Y = 5.0, 51.0                     # key-ring hole diameter, centre from the bottom
QR_SIZE, QR_TOP, RAISE = 34.0, 12.0, 0.8       # code edge, margin from the top, raised height
POCKET_D, POCKET_H = gen.POCKET_D, gen.POCKET_H  # NFC pocket (shared with the stand's --nfc-pocket)
POCKET_Z0 = 0.8                                # its floor (pocket top 2.4: both on 0.2 mm layer tops)


def pause_z():
    """The first layer that covers the pocket: the pause fires before it prints."""
    return gen.pause_z(POCKET_Z0 + POCKET_H)


def face_z():
    return round(KT + gen.LAYER, 3)


def layers_xml():
    return gen.layers_xml(face_z(), pause_z())


def assemble(url):
    qr_poly, qr, _, mat = gen.qr_geometry(url, QR_SIZE, QR_TOP, full=True)
    qr_poly = affinity.translate(qr_poly, (KW - gen.PW) / 2, KH - gen.PH)   # from the stand's plate onto the tag
    cy = KH - QR_TOP - QR_SIZE / 2
    outline = gen.rounded_rect(KW, KH, KR).difference(Point(KW / 2, HOLE_Y).buffer(HOLE_D / 2, resolution=48))
    pocket = gen.nfc_pocket(KW / 2, cy, POCKET_Z0)
    whole = gen.to_manifold(outline, 0, KT) - pocket + gen.to_manifold(qr_poly, KT - 0.01, KT + RAISE)
    m = whole.to_mesh()
    V = np.asarray(m.vert_properties)[:, :3].astype(float)
    F = np.asarray(m.tri_verts).astype(int)
    zc = V[F][:, :, 2]
    black = (zc.max(1) > KT + 0.05) & (zc.min(1) >= KT - 0.02)
    return V, F, black, qr, mat


def make(url, out, title="QR Keychain", check=True):
    V, F, black, qr, mat = assemble(url)
    mesh = trimesh.Trimesh(V, F, process=False)
    png = os.path.splitext(out)[0] + "-face.png"
    gen.render_front(V, F, black, png, w=KW, h=KH)
    result = {"qr_version": qr.version, "qr_error": qr.error, "modules": mat.shape[0],
              "module_mm": round(QR_SIZE / mat.shape[0], 2), "pocket_mm": [POCKET_D, POCKET_H],
              "pause_before_layer_mm": pause_z(), "face_change_mm": face_z(),
              "watertight": bool(mesh.is_watertight), "face_png": png, "out": out}
    if check:
        ok, texts = gen.scan_check(png, url)
        result.update(scan_ok=ok, scan_text=texts)
        if not ok:
            raise gen.StandError("the code did not scan back", 3)
    ext = gen.write_3mf(V, F, black, out, title, layers_xml=layers_xml())
    result["size_mm"] = [round(e, 1) for e in ext]
    return result


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--title", default="QR Keychain")
    a = ap.parse_args()
    try:
        print(json.dumps(make(a.url, a.out, a.title)))
    except gen.StandError as e:
        print(json.dumps({"error": str(e), "code": e.code}))
        sys.exit(e.code)
