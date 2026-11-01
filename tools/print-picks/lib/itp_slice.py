#!/usr/bin/env python3
"""Slice ITP print-pick parts with Bambu Studio's CLI for the A1 (PLA Basic).

NOT A PRINT FILE (task e912b835, 2026-11-01). What this writes has no bed type (Cool Plate, a 35 C
bed: the first layer lifts on our PEI plates), only the preset's walls and infill, every colour on one
plate, the generic start gcode and an empty printer_model_id (the A1 refuses it). It stays as the
library print_check.py imports (flatten, run) and as a quick grams/time look. Anything that goes to
a printer, a product or a buyer's name, comes from print_check.py; an order goes through
order_print.make_print, which every make_*.py calls.

usage: python3 itp_slice.py job.json
  job.json = {"name": "...", "outdir": "...", "process": "0.20mm Standard @BBL A1",
              "parts": [{"stl": "a.stl", "slot": 1}, ...],
              "colors": ["#FFFFFF", ...], "color_names": ["White", ...],
              "overrides": {...}}

Follows the bambu-printing skill to the letter: presets flattened (the CLI does not
walk `inherits`), --export-3mf takes a bare name with --outputdir, the CLI is waited
on by its OUTPUT FILE and then killed, parts go in as ONE object with --assemble and
get their extruder by REPLACING the exporter's own entry, and every per-filament
array is padded to the filament count. Real grams and time are read back out of
Metadata/slice_info.config and the gcode header; nothing here is estimated.
"""
import json, os, re, shutil, signal, subprocess, sys, time, zipfile

PROFILES = "/var/lib/flatpak/app/com.bambulab.BambuStudio/current/active/files/share/BambuStudio/profiles/BBL"
SLICER = ["flatpak", "run", "--command=bambu-studio", "com.bambulab.BambuStudio"]
MACHINE = "machine/Bambu Lab A1 0.4 nozzle.json"
FILAMENT = "filament/Bambu PLA Basic @BBL A1.json"

# Our parts are designed support-free (flat ornaments, an upright hoodie with
# sub-45-degree overhangs, a flat-backed pencil). Supports stay OFF on purpose.
SHOP = {"enable_support": "0", "brim_type": "auto_brim"}


def flatten(rel, seen=()):
    if rel in seen:
        raise RuntimeError(f"preset {rel} inherits itself")
    with open(os.path.join(PROFILES, rel)) as f:
        node = json.load(f)
    parent = node.pop("inherits", "")
    if not parent:
        return node
    folder = rel.split("/")[0]
    for cand in dict.fromkeys([f"{folder}/{parent}.json", f"process/{parent}.json",
                               f"machine/{parent}.json", f"filament/{parent}.json"]):
        if os.path.exists(os.path.join(PROFILES, cand)):
            merged = flatten(cand, seen + (rel,))
            merged.update(node)
            return merged
    raise RuntimeError(f"preset {rel} inherits {parent}, which was not found")


def run(args, expected, label, timeout=900):
    if os.path.exists(expected):
        os.remove(expected)
    log = open(expected + ".log", "w")
    env = dict(os.environ)
    # Headless on purpose. The only thing a display buys is the plate thumbnail, and the
    # flatpak's GL cannot open a window on Saturn anyway (tried :1, "Invalid OpenGL version").
    p = subprocess.Popen(SLICER + args, stdout=log, stderr=subprocess.STDOUT, start_new_session=True, env=env)
    t0 = time.time()
    last = -1
    while True:
        time.sleep(1.5)
        if os.path.exists(expected):
            size = os.path.getsize(expected)
            if size > 0 and size == last:
                break  # the file is there and has stopped growing: the only success worth believing
            last = size
        elif p.poll() is not None:
            log.close()
            tail = open(expected + ".log").read()[-1500:]
            raise RuntimeError(f"{label} produced nothing:\n{tail}")
        if time.time() - t0 > timeout:
            os.killpg(p.pid, signal.SIGKILL)
            raise RuntimeError(f"{label} timed out")
    try:
        os.killpg(p.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    p.wait(timeout=30)
    log.close()


def assign_extruders(xml, slot_of):
    def fix(m):
        block = m.group(0)
        name = re.search(r'<metadata key="source_file" value="([^"]*)"/>', block) or \
            re.search(r'<metadata key="name" value="([^"]*)"/>', block)
        slot = slot_of.get(os.path.basename(name.group(1))) if name else None
        if not slot:
            return block
        tag = f'<metadata key="extruder" value="{slot}"/>'
        if re.search(r'<metadata key="extruder" value="\d+"/>', block):
            return re.sub(r'<metadata key="extruder" value="\d+"/>', tag, block)
        return re.sub(r'(<metadata key="name" value="[^"]*"/>)', r'\1\n      ' + tag, block, count=1)
    return re.sub(r'<part\s[\s\S]*?</part>', fix, xml)


def with_slots(cfg, colors):
    n = max(1, len(colors))
    first = lambda k, d: (cfg.get(k) or [d])[0] if isinstance(cfg.get(k), list) else d
    cfg = dict(cfg)
    cfg["filament_colour"] = list(colors)
    cfg["default_filament_colour"] = list(colors)
    for k, d in (("filament_type", "PLA"), ("filament_ids", ""), ("filament_settings_id", "")):
        cfg[k] = [first(k, d)] * n
    cfg["filament_map"] = [str(i + 1) for i in range(n)]
    # The machine profile ships a 4x4 flush matrix. With 2 or 3 filaments the CLI
    # refuses: "Flush volumes matrix do not match to the correct size!" (return -100).
    # Resize it, keeping Bambu's flat default of 280 mm3 per change.
    off = next((v for v in cfg.get("flush_volumes_matrix", []) if v != "0"), "280")
    cfg["flush_volumes_matrix"] = ["0" if i == j else off for i in range(n) for j in range(n)]
    vec = cfg.get("flush_volumes_vector") or ["140"]
    cfg["flush_volumes_vector"] = [vec[0]] * (2 * n)
    for k in ("filament_flush_temp", "filament_flush_temp_fast", "filament_flush_volumetric_speed"):
        if isinstance(cfg.get(k), list) and cfg[k]:
            cfg[k] = [cfg[k][0]] * n
    return cfg


def rezip(path, replace):
    tmp = path + ".tmp"
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = replace[item.filename].encode() if item.filename in replace else zin.read(item.filename)
            zout.writestr(item, data)
    os.replace(tmp, path)


def fmt_time(s):
    s = int(round(s))
    return f"{s // 3600}h {s % 3600 // 60}m {s % 60}s"


def main(job_path):
    job = json.load(open(job_path))
    out = os.path.abspath(job["outdir"])
    work = os.path.join(out, "_slice")
    os.makedirs(work, exist_ok=True)
    colors = job["colors"]
    names = job.get("color_names", colors)

    machine = flatten(MACHINE)
    process = flatten("process/" + job.get("process", "0.20mm Standard @BBL A1") + ".json")
    process.update(SHOP)
    process.update(job.get("overrides", {}))
    filament = flatten(FILAMENT)
    for nm, obj in (("machine", machine), ("process", process), ("filament", filament)):
        json.dump(obj, open(os.path.join(work, nm + ".json"), "w"))
    mf, pf, ff = (os.path.join(work, n + ".json") for n in ("machine", "process", "filament"))
    common = ["--load-settings", f"{mf};{pf}", "--load-filaments", ";".join([ff] * len(colors))]

    files, slot_of = [], {}
    for part in job["parts"]:
        dst = os.path.join(work, os.path.basename(part["stl"]))
        shutil.copy(part["stl"], dst)
        files.append(dst)
        slot_of[os.path.basename(dst)] = part["slot"]

    project = os.path.join(work, "project.3mf")
    run(files + common + ["--assemble", "--export-3mf", "project.3mf", "--outputdir", work], project, "export")
    with zipfile.ZipFile(project) as z:
        cfg = z.read("Metadata/model_settings.config").decode()
        settings = json.loads(z.read("Metadata/project_settings.config").decode())
    cfg2 = assign_extruders(cfg, slot_of)
    rezip(project, {"Metadata/model_settings.config": cfg2,
                    "Metadata/project_settings.config": json.dumps(with_slots(settings, colors), indent=4)})
    got = re.findall(r'<metadata key="extruder" value="(\d+)"/>', cfg2)

    sliced = os.path.join(work, "sliced.gcode.3mf")
    run([project] + common + ["--slice", "0", "--export-3mf", "sliced.gcode.3mf", "--outputdir", work], sliced, "slice")

    with zipfile.ZipFile(sliced) as z:
        info = z.read("Metadata/slice_info.config").decode()
        gcode = z.read("Metadata/plate_1.gcode").decode(errors="replace")
        pset = json.loads(z.read("Metadata/project_settings.config").decode())
        if "Metadata/plate_1.png" in z.namelist():
            open(os.path.join(out, "slice_plate.png"), "wb").write(z.read("Metadata/plate_1.png"))
    pred = float(re.search(r'key="prediction" value="([\d.]+)"', info).group(1))
    weight = float(re.search(r'key="weight" value="([\d.]+)"', info).group(1))
    fils = re.findall(r'<filament id="(\d+)"[^>]*used_m="([\d.]+)" used_g="([\d.]+)"', info)
    changes = len(re.findall(r'^M620 S\d+A', gcode, re.M))
    header_time = re.search(r'; model printing time: ([^;\n]+)', gcode)
    total_time = re.search(r'; total estimated time: ([^;\n]+)', gcode)
    max_z = re.search(r'; max_z_height: ([\d.]+)', gcode)
    loglines = [l.strip() for l in open(sliced + ".log") if re.search(r'\b(error|warning)\b', l, re.I) and "trace" not in l]
    thumb = [l for l in loglines if re.search(r'glfw|GLFW|DISPLAY|OpenGL', l)]
    warn = [l for l in loglines if l not in thumb][:15]

    res = {}
    if os.path.exists(os.path.join(work, "result.json")):
        res = json.load(open(os.path.join(work, "result.json")))
    lines = [f"ITP print pick: {job['name']}",
             f"Sliced {time.strftime('%Y-%m-%d %H:%M %Z')} with Bambu Studio CLI 02.08.02.61 (flatpak), Bambu Lab A1 0.4 nozzle, Bambu PLA Basic @BBL A1",
             f"Process: {process.get('name', job.get('process'))}  layer {process.get('layer_height')} mm, supports {'on' if process.get('enable_support') == '1' else 'off'}, brim {process.get('brim_type')}",
             f"Layer height in the sliced file's own settings: {pset.get('layer_height')} mm (checked, not assumed)",
             "",
             f"Print time (slice_info prediction): {fmt_time(pred)}  ({pred:.0f} s)",
             f"Gcode header: model printing time {header_time.group(1).strip() if header_time else '?'}; total estimated {total_time.group(1).strip() if total_time else '?'}",
             f"Total filament: {weight:.2f} g",
             f"Max Z: {max_z.group(1) if max_z else '?'} mm",
             f"Filament changes (M620 S<n>A, the first load is not one) in gcode: {changes}",
             f"CLI result.json: return_code {res.get('return_code')} '{res.get('error_string')}'",
             "", "Filament per AMS slot:"]
    for fid, m, g in fils:
        i = int(fid) - 1
        lines.append(f"  slot {fid}: {names[i] if i < len(names) else '?'} ({colors[i] if i < len(colors) else '?'})  {float(g):.2f} g  {float(m):.2f} m")
    lines += ["", "Parts -> slot: " + ", ".join(f"{k}={v}" for k, v in slot_of.items()),
              f"Extruder entries in project after patch: {got}",
              "", "Slicer warnings/errors in the log: " + ("none" if not warn else "")] + ["  " + w for w in warn] + \
             ([f"(Not slice errors: {len(thumb)} GLFW lines from the plate-thumbnail renderer, which has no display in a headless run.)"] if thumb else [])
    open(os.path.join(out, "slice.txt"), "w").write("\n".join(lines) + "\n")
    shutil.copy(sliced, os.path.join(out, job["name"] + ".gcode.3mf"))
    shutil.copy(project, os.path.join(out, job["name"] + ".3mf"))
    print("\n".join(lines))
    return {"seconds": pred, "grams": weight, "per_slot": [(int(a), float(c)) for a, b, c in fils], "changes": changes}


if __name__ == "__main__":
    main(sys.argv[1])
