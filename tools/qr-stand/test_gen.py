"""Checks for the QR stand generator.

  C:/Users/David/.itp-qr-stand/venv/Scripts/python -m unittest tools/qr-stand/test_gen.py

QR_STAND_SLICE_TEST=1 also slices a stand on the Bambu Studio command line (Earth
only) and reads the gcode back, which is the one check that proves the colours.
"""
import json, os, re, shutil, subprocess, sys, tempfile, unittest, zipfile

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
