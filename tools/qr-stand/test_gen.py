"""Checks for the QR stand generator.

  C:/Users/David/.itp-qr-stand/venv/Scripts/python -m unittest tools/qr-stand/test_gen.py

QR_STAND_SLICE_TEST=1 also slices a stand on the Bambu Studio command line (Earth
only) and reads the gcode back, which is the one check that proves the colours.
"""
import json, math, os, re, shutil, subprocess, sys, tempfile, unittest, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gen  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

SLICER = os.environ.get("BAMBU_STUDIO_EXE", "C:/Program Files/Bambu Studio/bambu-studio.exe")


def cup_logo(path):
    im = Image.new("RGB", (400, 400), "white")
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((90, 170, 270, 330), 30, fill=(60, 30, 20))
    d.ellipse((240, 200, 330, 290), outline=(60, 30, 20), width=22)
    im.save(path)


# Darrell's stand with words (Business items "Same with words", 2026-10-30): his 62 mm code leaves
# 120 - 50.8 - 6 - 62 = 1.2 mm over the nameplate space; a 53 mm code leaves 10.2. The page centres
# the words in that room, 2 mm off the code and the band: 55.9 mm up, 6.2 mm capitals.
DARRELL = dict(full=True, top=6, clear_bottom=50.8)
WORDS_53 = dict(DARRELL, size=53, text_y=55.9, text_cap=6.2)


def slice_and_read(test, path3mf, V):
    """Slice on the 2.1 command line and read the gcode back in the model's own mm.
    write_3mf centres the model and puts it at (128, 85) on the bed, so bed - that = model.
    Returns (layers {z: [(x, y) along every extrusion]}, pauses [(z, points already printed on that
    layer)], loads [(z, filament)], gcode)."""
    out = os.path.dirname(path3mf)
    subprocess.run([SLICER, path3mf, "--slice", "0", "--export-3mf", "out.gcode.3mf", "--outputdir", out],
                   capture_output=True, timeout=600)
    gcode = zipfile.ZipFile(os.path.join(out, "out.gcode.3mf")).read("Metadata/plate_1.gcode").decode("utf-8", "replace")
    c = (V.min(0) + V.max(0)) / 2
    dx, dy = 128.0 - c[0], 85.0 - c[1]
    layers, pauses, loads = {}, [], []
    x = y = z_now = None
    for raw in gcode.splitlines():
        m = re.match(r"; Z_HEIGHT: ([\d.]+)", raw)
        if m:
            z_now = float(m.group(1))
            continue
        line = raw.split(";")[0].strip()
        if line == "M400 U1":
            pauses.append((z_now, len(layers.get(z_now, []))))
        m = re.match(r"^M620 S(\d+)A", line)
        if m:
            loads.append((z_now, int(m.group(1))))
        if not re.match(r"^G[0-3] ", line):
            continue
        p = dict((w[0], float(w[1:])) for w in line.split()[1:] if w[0] in "XYE" and len(w) > 1)
        nx, ny = p.get("X", x), p.get("Y", y)
        if p.get("E", 0) > 0 and x is not None and nx is not None and z_now is not None:
            steps = max(1, int(math.hypot(nx - x, ny - y) / 0.5))   # sample along the line, not just its ends
            layers.setdefault(z_now, []).extend(
                (x + (nx - x) * i / steps - dx, y + (ny - y) * i / steps - dy) for i in range(steps + 1))
        x, y = nx, ny
    test.assertEqual(gcode.count("; FEATURE: Support"), 0)
    return layers, pauses, loads, gcode


def face_points(layers):
    """What prints in the face colour, on the plate (not the leg or the prime tower)."""
    return [(x, y) for z, pts in layers.items() if z > gen.PT + 0.01
            for x, y in pts if 0 <= x <= gen.PW and 0 <= y <= gen.PH]


class GenTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def out(self, name="stand.3mf"):
        return os.path.join(self.dir, name)

    def test_58_bytes_fits_and_59_is_refused_with_the_shop_words(self):
        ok = "https://example.com/" + "a" * 38
        self.assertEqual(len(ok), 58)
        self.assertIsNone(gen.link_problem(ok))
        self.assertEqual(gen.link_problem(ok + "b"), "use a shorter link")
        with self.assertRaises(gen.StandError) as e:
            gen.make(ok + "b", "Review Us", self.out())
        self.assertEqual((str(e.exception), e.exception.code), ("use a shorter link", 2))
        self.assertFalse(os.path.exists(self.out()))

    def test_58_bytes_is_qr_version_6(self):
        r = gen.make("https://example.com/" + "a" * 38, "Review Us", self.out())
        self.assertEqual(r["qr_version"], 6)
        self.assertTrue(r["scan_ok"])

    def test_logo_is_printed_in_and_the_face_still_scans(self):
        logo = os.path.join(self.dir, "cup.jpg")
        cup_logo(logo)
        r = gen.make("https://bellascafe.com/menu", "Scan For Menu", self.out(), logo=logo)
        self.assertEqual(r["logo"], "printed")
        self.assertGreater(r["logo_share"], 0.2)
        self.assertTrue(r["scan_ok"])
        self.assertEqual(r["scan_text"], ["https://bellascafe.com/menu"])
        self.assertTrue(r["watertight"])

    def test_white_logo_on_a_clear_sheet_is_read_against_black(self):
        logo = os.path.join(self.dir, "tri.png")
        t = Image.new("RGBA", (300, 300), (0, 0, 0, 0))
        ImageDraw.Draw(t).polygon([(150, 20), (280, 280), (20, 280)], fill=(255, 255, 255, 255))
        t.save(logo)
        r = gen.make("https://davidtrinidad.com", "Visit Our Website", self.out(), logo=logo)
        self.assertGreater(r["logo_share"], 0.3)

    def test_a_hairline_logo_is_refused_rather_than_printed_as_specks(self):
        logo = os.path.join(self.dir, "hair.png")
        im = Image.new("RGB", (600, 600), "white")
        ImageDraw.Draw(im).line((10, 300, 590, 300), fill="black", width=1)
        im.save(logo)
        with self.assertRaises(gen.StandError) as e:
            gen.make("https://davidtrinidad.com", "Scan Me", self.out(), logo=logo)
        self.assertEqual(e.exception.code, 4)

    def test_full_code_no_words_leaves_the_bottom_clear_for_a_nameplate(self):
        # Darrell's stand (2026-10-30): whole code, no centre square, no caption,
        # 62 mm code 6 mm from the top, bottom 2 in empty for his 1.8 in nameplate.
        r = gen.make("https://darrellmccutchen.com", "", self.out(), full=True, size=62, top=6, clear_bottom=50.8)
        self.assertEqual(r["blank_mm"], 0.0)
        self.assertTrue(r["scan_ok"])
        self.assertTrue(r["watertight"])
        V, F, black, *_ = gen.assemble("https://darrellmccutchen.com", "", full=True, size=62, top=6)
        raised = V[F[black]].reshape(-1, 3)
        self.assertGreaterEqual(raised[:, 1].min(), 50.8)
        with self.assertRaises(gen.StandError):   # the default caption would sit in the nameplate's spot
            gen.make("https://darrellmccutchen.com", "Scan Me", self.out(), full=True, size=62, top=6, clear_bottom=50.8)

    def test_default_stand_keeps_its_blank_centre_square(self):
        r = gen.make("https://davidtrinidad.com", "Scan Me", self.out())
        self.assertGreater(r["blank_mm"], 20)
        self.assertEqual(r["qr_error"], "H")

    def test_nfc_keychain_pauses_before_the_layer_that_covers_the_pocket(self):
        import keychain
        r = keychain.make("https://darrellmccutchen.com", self.out("key.3mf"))
        self.assertTrue(r["scan_ok"])
        self.assertTrue(r["watertight"])
        xml = zipfile.ZipFile(self.out("key.3mf")).read("Metadata/custom_gcode_per_layer.xml").decode()
        self.assertIn('top_z="2.6" type="1"', xml)        # pocket is 0.8-2.4 mm: pause before 2.4-2.6
        self.assertIn('top_z="3.8" type="2"', xml)        # face colour from the first raised layer

    def test_a_logo_with_nothing_in_it_is_refused(self):
        logo = os.path.join(self.dir, "blank.png")
        Image.new("RGB", (200, 200), "white").save(logo)
        with self.assertRaises(gen.StandError) as e:
            gen.make("https://davidtrinidad.com", "Scan Me", self.out(), logo=logo)
        self.assertEqual(e.exception.code, 4)

    def test_no_logo_leaves_the_square_blank_for_a_sticker(self):
        r = gen.make("https://davidtrinidad.com", "Visit Our Website", self.out())
        self.assertEqual(r["logo"], "blank")
        self.assertTrue(r["scan_ok"])

    def test_the_3mf_carries_the_face_band_a_cli_safe_config_and_no_paint(self):
        gen.make("https://davidtrinidad.com", "Scan Me", self.out())
        z = zipfile.ZipFile(self.out())
        xml = z.read("Metadata/custom_gcode_per_layer.xml").decode()
        self.assertIn('top_z="6.2"', xml)
        self.assertIn('extruder="2"', xml)
        self.assertNotIn("paint_color", z.read("3D/Objects/object_1.model").decode())
        self.assertIn("BambuStudio-02.01.01.52", z.read("3D/3dmodel.model").decode())
        cfg = json.loads(z.read("Metadata/project_settings.config"))
        for k, v in gen.CLI_SAFE.items():
            self.assertEqual(cfg[k], v)
        self.assertEqual(cfg["enable_support"], "0")
        self.assertEqual(cfg["layer_height"], "0.2")

    def test_face_band_starts_on_the_first_raised_layer(self):
        self.assertEqual(gen.face_change_z(), 6.2)

    def test_a_face_that_does_not_scan_back_writes_no_print_file(self):
        real = gen.scan_check
        gen.scan_check = lambda png, url: (False, ["something else"])
        try:
            with self.assertRaises(gen.StandError) as e:
                gen.make("https://davidtrinidad.com", "Scan Me", self.out())
        finally:
            gen.scan_check = real
        self.assertEqual(e.exception.code, 3)
        self.assertFalse(os.path.exists(self.out()))

    # ---- placed words, a logo below the code, an NFC pocket in the stand (task 96cc1d3e) ----

    def test_words_at_text_y_sit_between_the_code_and_the_nameplate_space(self):
        r = gen.make("https://darrellmccutchen.com", "Scan Me", self.out(), **WORDS_53)
        self.assertTrue(r["scan_ok"])
        self.assertTrue(r["watertight"])
        lo, hi = r["words_mm"]
        code_bottom = 120 - 6 - 53
        self.assertGreaterEqual(lo, 50.8)                       # the nameplate space stays empty
        self.assertLessEqual(hi, code_bottom - gen.WORDS_GAP)   # and the code keeps its white
        self.assertAlmostEqual((lo + hi) / 2, 55.9, delta=0.3)
        V, F, black, *_ = gen.assemble("https://darrellmccutchen.com", "Scan Me", **WORDS_53)
        raised = V[F[black]].reshape(-1, 3)
        self.assertGreaterEqual(raised[:, 1].min(), 50.8)
        self.assertTrue(((raised[:, 1] > 50.8) & (raised[:, 1] < code_bottom)).any())

    def test_words_over_darrells_62mm_code_have_no_room_and_print_nothing(self):
        # 1.2 mm between his 62 mm code and the nameplate space: no size of words fits there.
        for cap in (6.2, 3.0):
            with self.assertRaises(gen.StandError) as e:
                gen.make("https://darrellmccutchen.com", "Scan Me", self.out(),
                         **dict(DARRELL, size=62, text_y=51.4, text_cap=cap))
            self.assertEqual(e.exception.code, 1)
        self.assertFalse(os.path.exists(self.out()))

    def test_placed_words_stay_on_the_plate_off_the_code_and_big_enough(self):
        for face, words in [(dict(text_y=1.5), "off the plate"), (dict(text_y=60.0), "into the code"),
                            (dict(text_y=16.0, text_cap=2.0), "don't print cleanly")]:
            with self.assertRaises(gen.StandError) as e:
                gen.make("https://davidtrinidad.com", "Scan Me", self.out(), **face)
            self.assertEqual(e.exception.code, 1)
            self.assertIn(words, str(e.exception))
        # Without --text-y/--text-cap the words go where they always did, and nothing new is reported.
        r = gen.make("https://davidtrinidad.com", "Scan Me", self.out())
        self.assertNotIn("words_mm", r)

    def test_logo_below_the_whole_code_scans_and_sits_between_code_and_words(self):
        logo = os.path.join(self.dir, "cup.jpg")
        cup_logo(logo)
        r = gen.make("https://bellascafe.com/menu", "Scan For Menu", self.out(), logo=logo, full=True, logo_at="below")
        self.assertTrue(r["scan_ok"])
        self.assertEqual((r["blank_mm"], r["logo"], r["logo_at"]), (0.0, "printed", "below"))
        x, y, side = r["logo_box_mm"]
        # The square the Business items preview draws (catalog.ts logoBelowBox): 2 mm under the 75 mm code,
        # 1.5 mm over the 8.5 mm capitals centred 16 mm up, centred across.
        self.assertEqual([x, y, side], [38.12, 21.75, 13.75])
        V, F, black, *_ = gen.assemble("https://bellascafe.com/menu", "Scan For Menu", logo, full=True, logo_at="below")
        raised = V[F[black]].reshape(-1, 3)
        inside = (raised[:, 0] > x) & (raised[:, 0] < x + side) & (raised[:, 1] > y) & (raised[:, 1] < y + side)
        self.assertTrue(inside.any())

    def test_logo_below_needs_the_whole_code_and_room_under_it(self):
        logo = os.path.join(self.dir, "cup.jpg")
        cup_logo(logo)
        cases = [(dict(full=True), "no centre square"),            # --full-qr + logo in the middle: as before
                 (dict(logo_at="below"), "whole code"),            # below goes with the whole code
                 (dict(DARRELL, size=62, logo_at="below"), "no room")]   # 62 mm code over the nameplate
        for face, words in cases:
            with self.assertRaises(gen.StandError) as e:
                gen.make("https://darrellmccutchen.com", "", self.out(), logo=logo, **face)
            self.assertEqual(e.exception.code, 1)
            self.assertIn(words, str(e.exception))
        self.assertFalse(os.path.exists(self.out()))
        # No logo file yet: the whole code prints and the room stays empty for a sticker.
        r = gen.make("https://darrellmccutchen.com", "", self.out(), **dict(DARRELL, size=62, logo_at="below"))
        self.assertTrue(r["scan_ok"])

    def test_nfc_pocket_in_the_stand_beside_the_hook_slots_with_a_pause(self):
        r = gen.make("https://davidtrinidad.com", "Tap or Scan", self.out(), nfc=True)
        self.assertTrue(r["scan_ok"])
        self.assertTrue(r["watertight"])
        self.assertEqual(r["pocket_mm"], [26.5, 1.6])
        cx, cy, z0 = r["pocket_at_mm"]
        self.assertEqual((z0, round(gen.PT - z0 - 1.6, 3)), (3.2, 1.2))   # 1.2 mm of PLA over the tag, as the keychain
        self.assertEqual(cy, 120 - 7.5 - 75 / 2)                           # level with the code's centre
        self.assertAlmostEqual(cx - 26.5 / 2 - (gen.PW + gen.SLOT_W) / 2, 2.0, places=2)   # 2 mm wall to the hook slots
        self.assertEqual(r["pause_before_layer_mm"], 5.0)
        xml = zipfile.ZipFile(self.out()).read("Metadata/custom_gcode_per_layer.xml").decode()
        self.assertIn('top_z="5.0" type="1" extruder="1" color="#FFFFFF" extra="" gcode="M400 U1"', xml)
        self.assertIn('top_z="6.2" type="2"', xml)
        # The pocket takes exactly its own volume: it cuts into nothing else (not the slots, not the face).
        with_pocket = gen.build_plate("https://davidtrinidad.com", "Tap or Scan", nfc=True)[0].volume()
        without = gen.build_plate("https://davidtrinidad.com", "Tap or Scan")[0].volume()
        pocket = gen.nfc_pocket(cx, cy, z0).volume()
        self.assertAlmostEqual(without - with_pocket, pocket, delta=0.5)
        self.assertAlmostEqual(pocket, math.pi * 13.25 ** 2 * 1.6, delta=2)

    def test_the_cli_keeps_one_json_line_and_the_same_exit_codes(self):
        py = sys.executable
        run = lambda *a: subprocess.run([py, os.path.join(HERE, "gen.py"), *a, "--out", self.out()],
                                        capture_output=True, text=True, timeout=300)
        p = run("--url", "https://example.com/" + "a" * 39, "--nfc-pocket", "--text-y", "30")
        self.assertEqual((p.returncode, json.loads(p.stdout)), (2, {"error": "use a shorter link", "code": 2}))
        p = run("--url", "https://darrellmccutchen.com", "--text", "Scan Me", "--full-qr", "--qr-size", "62",
                "--qr-top", "6", "--clear-bottom", "50.8", "--text-y", "51.4", "--text-cap", "6.2")
        self.assertEqual(p.returncode, 1)
        self.assertEqual(json.loads(p.stdout)["code"], 1)
        p = run("--url", "https://darrellmccutchen.com", "--text", "Scan Me", "--full-qr", "--qr-size", "53",
                "--qr-top", "6", "--clear-bottom", "50.8", "--text-y", "55.9", "--text-cap", "6.2", "--nfc-pocket")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        r = json.loads(p.stdout.strip().splitlines()[-1])
        self.assertEqual((r["scan_ok"], r["pause_before_layer_mm"]), (True, 5.0))
        self.assertEqual(len(p.stdout.strip().splitlines()), 1)

    @unittest.skipUnless(os.environ.get("QR_STAND_SLICE_TEST") and os.path.exists(SLICER), "slicer test is opt-in")
    def test_slices_words_above_the_nameplate_space(self):
        gen.make("https://darrellmccutchen.com", "Scan Me", self.out(), **WORDS_53)
        V, *_ = gen.assemble("https://darrellmccutchen.com", "Scan Me", **WORDS_53)
        layers, pauses, loads, _ = slice_and_read(self, self.out(), V)
        self.assertEqual((pauses, loads), ([], [(None, 0), (6.2, 1)]))
        face = face_points(layers)
        self.assertGreaterEqual(min(y for _, y in face), 50.8)        # nothing black in the nameplate space
        words = [p for p in face if 50.8 < p[1] < 120 - 6 - 53]
        self.assertGreater(len(words), 200)
        self.assertLessEqual(max(y for _, y in words), 120 - 6 - 53 - gen.WORDS_GAP)

    @unittest.skipUnless(os.environ.get("QR_STAND_SLICE_TEST") and os.path.exists(SLICER), "slicer test is opt-in")
    def test_slices_a_logo_below_the_whole_code(self):
        logo = os.path.join(self.dir, "cup.jpg")
        cup_logo(logo)
        r = gen.make("https://bellascafe.com/menu", "Scan For Menu", self.out(), logo=logo, full=True, logo_at="below")
        V, *_ = gen.assemble("https://bellascafe.com/menu", "Scan For Menu", logo, full=True, logo_at="below")
        layers, pauses, loads, _ = slice_and_read(self, self.out(), V)
        self.assertEqual((pauses, loads), ([], [(None, 0), (6.2, 1)]))
        x, y, side = r["logo_box_mm"]
        cup = [p for p in face_points(layers) if x < p[0] < x + side and y < p[1] < y + side]
        self.assertGreater(len(cup), 100)

    @unittest.skipUnless(os.environ.get("QR_STAND_SLICE_TEST") and os.path.exists(SLICER), "slicer test is opt-in")
    def test_slices_the_nfc_stand_with_one_pause_over_an_empty_pocket(self):
        r = gen.make("https://davidtrinidad.com", "Tap or Scan", self.out(), nfc=True)
        V, *_ = gen.assemble("https://davidtrinidad.com", "Tap or Scan", nfc=True)
        layers, pauses, loads, gcode = slice_and_read(self, self.out(), V)
        self.assertEqual(pauses, [(5.0, 0)])                  # one M400 U1, before the first covering layer prints
        self.assertEqual(loads, [(None, 0), (6.2, 1)])        # the pause is not a filament change
        cx, cy, _ = r["pocket_at_mm"]
        in_pocket = lambda z, r_=26.5 / 2 - 0.3: [p for p in layers.get(z, []) if math.hypot(p[0] - cx, p[1] - cy) < r_]
        for z in (3.4, 3.6, 3.8, 4.0, 4.2, 4.4, 4.6, 4.8):  # the pocket's own layers stay open for the tag
            self.assertEqual(in_pocket(z), [], z)
        self.assertGreater(len(in_pocket(3.2)), 100)          # its floor is solid
        self.assertGreater(len(in_pocket(5.0)), 100)          # and the layer after the pause closes it
        self.assertIn("; FEATURE: Bridge", gcode)

    @unittest.skipUnless(os.environ.get("QR_STAND_SLICE_TEST") and os.path.exists(SLICER), "slicer test is opt-in")
    def test_slices_white_plate_black_face(self):
        logo = os.path.join(self.dir, "cup.jpg")
        cup_logo(logo)
        gen.make("https://bellascafe.com/menu", "Scan For Menu", self.out(), logo=logo)
        subprocess.run([SLICER, self.out(), "--slice", "0", "--export-3mf", "out.gcode.3mf", "--outputdir", self.dir],
                       capture_output=True, timeout=600)
        z = zipfile.ZipFile(os.path.join(self.dir, "out.gcode.3mf"))
        gcode = z.read("Metadata/plate_1.gcode").decode("utf-8", "replace")
        info = z.read("Metadata/slice_info.config").decode()
        loads, z_now = [], None
        for line in gcode.splitlines():
            m = re.match(r"; Z_HEIGHT: ([\d.]+)", line)
            if m:
                z_now = float(m.group(1))
            m = re.match(r"^M620 S(\d+)A", line)
            if m:
                loads.append((z_now, int(m.group(1))))
        self.assertEqual(loads, [(None, 0), (6.2, 1)])
        self.assertEqual(gcode.count("; FEATURE: Support"), 0)
        self.assertEqual(len(re.findall(r"<filament id=", info)), 2)


if __name__ == "__main__":
    unittest.main()
