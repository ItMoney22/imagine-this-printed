#!/usr/bin/env python3
"""Read a sliced Bambu 3mf back, or hold one up against a product's PRINT.3mf.

usage:
  python3 compare_print.py <sliced.3mf>                       # what is in the file
  python3 compare_print.py <product>-PRINT.3mf <order>.3mf    # does the order file match the product's
  add --json <out.json> to write the result

Stdlib only, so it runs on any box (Saturn's venv, Earth's plain Python, Blender's Python).
Everything comes out of the file itself: Metadata/project_settings.config (the print settings),
Metadata/model_settings.config (plates, objects, per-object settings, filament per part),
Metadata/slice_info.config (printer model, per-plate time and grams) and each plate's gcode
(max Z, the bed temperature it actually heats to). Nothing is taken from a spec or a script.

A match means: the same bed type, the same project settings (every key, not a short list; only
the keys in IGNORE may differ), and the same plate list: same number of plates, and plate by plate
the same objects with the same per-object settings and the same filament slot on every part.
Plate and object NAMES are allowed to differ, because they carry the buyer's name.
(task e912b835, 2026-11-01)
"""
import json, re, sys, zipfile

# keys that may legitimately differ between the product file and an order file
IGNORE = {
    "filament_colour",          # a buyer may pick another colour where the product offers it
    "default_filament_colour",
    "filament_settings_id",     # follows the colour list length
}

# the settings the card names, shown first in every report
HEADLINE = ["curr_bed_type", "print_settings_id", "layer_height", "initial_layer_print_height", "wall_loops",
            "wall_generator", "top_shell_layers", "bottom_shell_layers", "sparse_infill_density",
            "sparse_infill_pattern", "ironing_type", "ironing_flow", "ironing_spacing", "brim_type",
            "seam_position", "enable_support", "enable_prime_tower", "textured_plate_temp", "cool_plate_temp"]


def _meta(block):
    return dict(re.findall(r'<metadata key="([^"]+)" value="([^"]*)"/>', block))


def read(path):
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        pset = json.loads(z.read("Metadata/project_settings.config"))
        ms = z.read("Metadata/model_settings.config").decode()
        info = z.read("Metadata/slice_info.config").decode() if "Metadata/slice_info.config" in names else ""
        gcodes = {n: z.read(n).decode(errors="replace") for n in names
                  if re.fullmatch(r"Metadata/plate_\d+\.gcode", n)}

    objects = {}
    for oid, body in re.findall(r'<object id="(\d+)">([\s\S]*?)</object>', ms):
        head = body.split("<part", 1)[0]
        om = _meta(head)
        parts = []
        for pb in re.findall(r"<part\s[\s\S]*?</part>", body):
            pm = _meta(pb)
            parts.append({"name": pm.get("name"), "extruder": pm.get("extruder", om.get("extruder")),
                          "subtype": (re.search(r'subtype="([^"]+)"', pb) or [None, "normal_part"])[1]})
        objects[oid] = {"name": om.pop("name", None), "extruder": om.pop("extruder", None),
                        "settings": {k: v for k, v in om.items()}, "parts": parts}

    plates = []
    info_plates = re.findall(r"<plate>[\s\S]*?</plate>", info)
    for blk in re.findall(r"<plate>[\s\S]*?</plate>", ms):
        pm = _meta(blk.split("<model_instance", 1)[0])
        idx = int(pm.get("plater_id", len(plates) + 1))
        objs = [objects.get(oid) for oid in re.findall(r'<metadata key="object_id" value="(\d+)"/>', blk)]
        g = gcodes.get(f"Metadata/plate_{idx}.gcode", "")
        ib = next((b for b in info_plates if re.search(rf'<metadata key="index" value="{idx}"/>', b)), "")
        im = _meta(ib)
        mz = re.search(r"; max_z_height: ([\d.]+)", g)
        plates.append({
            "index": idx,
            "name": pm.get("plater_name"),
            "bed_type": pm.get("bed_type"),
            "sliced": bool(g),
            "bed_temp_in_gcode": sorted(set(re.findall(r"^M1[49]0 S(\d+)", g, re.M)), key=int),
            "max_z": float(mz.group(1)) if mz else None,
            "time_s": float(im["prediction"]) if im.get("prediction") else None,
            "grams": float(im["weight"]) if im.get("weight") else None,
            "printer_model_id": im.get("printer_model_id"),
            "objects": [o for o in objs if o],
        })
    plates.sort(key=lambda p: p["index"])
    return {"file": path, "settings": pset, "plates": plates}


def signature(plate):
    """what has to match plate for plate; names are left out on purpose"""
    return [{"extruder": o["extruder"], "settings": o["settings"],
             "parts": sorted((p["subtype"], p["extruder"]) for p in o["parts"])} for o in plate["objects"]]


def summary(r):
    s = r["settings"]
    return {
        "file": r["file"],
        "curr_bed_type": s.get("curr_bed_type"),
        "headline": {k: s.get(k) for k in HEADLINE},
        "plates": [{"index": p["index"], "name": p["name"], "bed_type": p["bed_type"],
                    "bed_temp_in_gcode": p["bed_temp_in_gcode"], "max_z": p["max_z"], "time_s": p["time_s"],
                    "grams": p["grams"], "printer_model_id": p["printer_model_id"],
                    "objects": [{"name": o["name"], "extruder": o["extruder"], "settings": o["settings"],
                                 "part_slots": [p2["extruder"] for p2 in o["parts"]]} for o in p["objects"]]}
                   for p in r["plates"]],
    }


def compare(ref_path, new_path):
    a, b = read(ref_path), read(new_path)
    keys = sorted(set(a["settings"]) | set(b["settings"]))
    diff = {k: {"product": a["settings"].get(k), "order": b["settings"].get(k)}
            for k in keys if k not in IGNORE and a["settings"].get(k) != b["settings"].get(k)}
    plate_problems = []
    if len(a["plates"]) != len(b["plates"]):
        plate_problems.append(f"plate count {len(a['plates'])} in the product file, {len(b['plates'])} in the order file")
    for pa, pb in zip(a["plates"], b["plates"]):
        if signature(pa) != signature(pb):
            plate_problems.append(f"plate {pa['index']} ({pa['name']!r} vs {pb['name']!r}): objects, per-object "
                                  f"settings or filament slots differ")
        if pa["bed_type"] != pb["bed_type"]:
            plate_problems.append(f"plate {pa['index']} bed {pa['bed_type']!r} vs {pb['bed_type']!r}")
        if pa["bed_temp_in_gcode"] != pb["bed_temp_in_gcode"]:
            plate_problems.append(f"plate {pa['index']} bed temp {pa['bed_temp_in_gcode']} vs {pb['bed_temp_in_gcode']}")
        if pb["sliced"] is False:
            plate_problems.append(f"plate {pb['index']} has no gcode in the order file")
    pe = b["plates"] and all(p["printer_model_id"] == "N2S" for p in b["plates"] if p["sliced"])
    ok = (not diff and not plate_problems and b["settings"].get("curr_bed_type") == "Textured PEI Plate" and bool(pe))
    return {"match": ok, "settings_diff": diff, "plate_problems": plate_problems,
            "order_printer_model_id_N2S": bool(pe), "product": summary(a), "order": summary(b)}


def main(argv):
    out = None
    if "--json" in argv:
        i = argv.index("--json")
        out = argv[i + 1]
        argv = argv[:i] + argv[i + 2:]
    if len(argv) == 1:
        res = summary(read(argv[0]))
    elif len(argv) == 2:
        res = compare(argv[0], argv[1])
    else:
        print(__doc__)
        return 2
    text = json.dumps(res, indent=1)
    if out:
        open(out, "w").write(text + "\n")
    print(text)
    return 0 if len(argv) == 1 or res["match"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
