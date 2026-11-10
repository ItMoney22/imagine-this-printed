#!/usr/bin/env python3
"""QR keychain with an NFC tag sealed in the middle.

  keychain.py --url https://darrellmccutchen.com --out Darrell-Keychain.3mf
  keychain.py --url https://jalynndsimmons.com --text "Tap or Scan" --out Keychain.3mf

A 40 x 56 mm tag, 3.6 mm thick, key-ring hole at the top, the whole code raised
in black on the front (no centre square). --text adds words in the same black,
centred in the 10 mm under the code (task 0a71cddf). Inside, under the code, a
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
# Words under the code, where the Business items preview draws them (david-trinidad-com src/lib/business-items/face.ts):
# capitals 4 mm tall centred in the band under the code, at most 32 mm wide (shrunk to fit), 1 mm clear of the code
# and the bottom edge. Arial Bold "Tap or Scan" is 31.1 mm wide at 4 mm, strokes ~0.8 mm (two 0.42 mm lines).
WORDS_CAP, WORDS_MAX_W, WORDS_KEEP = 4.0, KW - 8, 1.0


def words_geometry(text):
    """The words as one shape on the tag, and the capital height they print at."""
    code_bottom = KH - QR_TOP - QR_SIZE
    centre, cap = code_bottom / 2, WORDS_CAP
    shape = gen.text_geometry(text, centre, cap)
    width = shape.bounds[2] - shape.bounds[0]
    if width > WORDS_MAX_W:
        cap *= WORDS_MAX_W / width
        if cap < gen.MIN_CAP:
            raise gen.StandError(f"too many words for the keychain: under {gen.MIN_CAP:g} mm tall they don't print cleanly", 1)
        shape = gen.text_geometry(text, centre, cap)
    shape = affinity.translate(shape, KW / 2 - gen.PW / 2, 0)   # text_geometry centres on the stand's plate
    if shape.bounds[1] < WORDS_KEEP or shape.bounds[3] > code_bottom - WORDS_KEEP:
        raise gen.StandError("the words run off the keychain or into the code", 1)
    return shape, cap


def pause_z():
    """The first layer that covers the pocket: the pause fires before it prints."""
    return gen.pause_z(POCKET_Z0 + POCKET_H)


def face_z():
    return round(KT + gen.LAYER, 3)


def layers_xml():
    return gen.layers_xml(face_z(), pause_z())


def assemble(url, text=""):
    qr_poly, qr, _, mat = gen.qr_geometry(url, QR_SIZE, QR_TOP, full=True)
    qr_poly = affinity.translate(qr_poly, (KW - gen.PW) / 2, KH - gen.PH)   # from the stand's plate onto the tag
    placed = {}
    if text.strip():
        words, cap = words_geometry(text.strip())
        qr_poly = qr_poly.union(words)
        placed = {"words_mm": [round(words.bounds[1], 2), round(words.bounds[3], 2)], "words_cap_mm": round(cap, 2)}
    cy = KH - QR_TOP - QR_SIZE / 2
    outline = gen.rounded_rect(KW, KH, KR).difference(Point(KW / 2, HOLE_Y).buffer(HOLE_D / 2, resolution=48))
    pocket = gen.nfc_pocket(KW / 2, cy, POCKET_Z0)
    whole = gen.to_manifold(outline, 0, KT) - pocket + gen.to_manifold(qr_poly, KT - 0.01, KT + RAISE)
    m = whole.to_mesh()
    V = np.asarray(m.vert_properties)[:, :3].astype(float)
    F = np.asarray(m.tri_verts).astype(int)
    zc = V[F][:, :, 2]
    black = (zc.max(1) > KT + 0.05) & (zc.min(1) >= KT - 0.02)
    return V, F, black, qr, mat, placed


def make(url, out, title="QR Keychain", check=True, text=""):
    V, F, black, qr, mat, placed = assemble(url, text)
    mesh = trimesh.Trimesh(V, F, process=False)
    png = os.path.splitext(out)[0] + "-face.png"
    gen.render_front(V, F, black, png, w=KW, h=KH)
    result = {"qr_version": qr.version, "qr_error": qr.error, "modules": mat.shape[0],
              "module_mm": round(QR_SIZE / mat.shape[0], 2), "pocket_mm": [POCKET_D, POCKET_H],
              "pause_before_layer_mm": pause_z(), "face_change_mm": face_z(),
              "watertight": bool(mesh.is_watertight), "face_png": png, "out": out, **placed}
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
    ap.add_argument("--text", default="", help='words under the code in the face colour, e.g. "Tap or Scan" (default: none)')
    a = ap.parse_args()
    try:
        print(json.dumps(make(a.url, a.out, a.title, text=a.text)))
    except gen.StandError as e:
        print(json.dumps({"error": str(e), "code": e.code}))
        sys.exit(e.code)
