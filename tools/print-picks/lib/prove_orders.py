#!/usr/bin/env python3
"""Make one new-name order of every ITP print pick and prove its print file matches the product's.

usage (Saturn):  python3 ~/memory/watchtower/assets/itp-print-picks/lib/prove_orders.py [--only 2-name-clicker]

For each product folder it runs that product's own make_*.py in Blender with a new buyer name into
assets/itp-orders/<n>-<slug>/<NAME>/ (a folder the Products shelf does not read), so the order goes
down the real path: make script -> order_print -> print_check -> compare against <slug>-PRINT.3mf.
Then it reads curr_bed_type and the plate list back out of every order file (compare_print.py) and
writes assets/itp-orders/_proof/proof.json. Renders are skipped (--no-render): they are pictures,
not print settings. (task e912b835, 2026-11-01)
"""
import hashlib, json, os, shutil, subprocess, sys, time

LIB = os.path.dirname(os.path.abspath(__file__))
PICKS = os.path.dirname(LIB)
ASSETS = os.path.dirname(PICKS)
ORDERS = os.path.join(ASSETS, "itp-orders")
sys.path.insert(0, LIB)
import compare_print  # noqa: E402

# a different-length name where the product allows it, so the plate list is proved independent of the name
ORDERS_TO_MAKE = [
    ("1-shadow-ornament", "make_shadow_ornament.py", ["--name", "The Garcias"], "The Garcias", "shadow-ornament"),
    ("2-name-clicker", "make_name_clicker.py", ["--name", "SOPHIA"], "SOPHIA", "name-clicker"),
    ("3-dino-ornament", "make_dino_ornament.py", ["--name", "MAYA"], "MAYA", "dino-ornament"),
    ("4-hoodie-pen-holder", "make_hoodie_pen_holder.py", ["--name", "LUCAS", "--number", "7"], "LUCAS 7", "hoodie-pen-holder"),
    ("5-teacher-marker-holder", "make_marker_holder.py", ["--name", "Ms. Rivera"], "Ms. Rivera", "teacher-marker-holder"),
]


def blender():
    for c in (os.environ.get("BLENDER"), os.path.expanduser("~/opt/blender/blender"), shutil.which("blender")):
        if c and os.path.exists(c):
            return c
    raise SystemExit("no Blender found: set BLENDER=/path/to/blender")


def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()[:12]


def wait_for_new_code(timeout=900):
    """Syncthing may still be carrying the edited scripts: every make script must call order_print"""
    need = [os.path.join(PICKS, d, m) for d, m, *_ in ORDERS_TO_MAKE] + [os.path.join(LIB, "order_print.py")]
    t0 = time.time()
    while True:
        stale = [p for p in need if not os.path.exists(p) or
                 (p.endswith(".py") and "order_print" not in open(p).read())]
        if not stale:
            return
        if time.time() - t0 > timeout:
            raise SystemExit(f"these files never arrived with the order_print change: {stale}")
        print("waiting for Syncthing:", [os.path.basename(p) for p in stale], flush=True)
        time.sleep(20)


def main(argv):
    only = argv[argv.index("--only") + 1] if "--only" in argv else None
    wait_for_new_code()
    bl = blender()
    proof_dir = os.path.join(ORDERS, "_proof")
    os.makedirs(proof_dir, exist_ok=True)
    proof_path = os.path.join(proof_dir, "proof.json")
    proof = json.load(open(proof_path)) if os.path.exists(proof_path) else {}
    proof["code"] = {os.path.relpath(p, PICKS): sha(p) for p in
                     [os.path.join(LIB, f) for f in ("order_print.py", "compare_print.py", "print_check.py", "itp_slice.py")] +
                     [os.path.join(PICKS, d, m) for d, m, *_ in ORDERS_TO_MAKE]}
    proof["blender"] = bl
    proof.setdefault("products", {})
    for d, make, args, label, slug in ORDERS_TO_MAKE:
        if only and only != d:
            continue
        safe = "".join(ch if ch.isalnum() else "-" for ch in label).strip("-")
        out = os.path.join(ORDERS, d, safe)
        if os.path.isdir(out):
            shutil.rmtree(out)  # a proof starts clean: no file of an earlier run can stand in for this one
        os.makedirs(out)
        log = os.path.join(proof_dir, f"{d}.log")
        cmd = [bl, "-b", "-P", os.path.join(PICKS, d, make), "--"] + args + ["--out", out, "--no-render"]
        print(f"[{d}] {' '.join(cmd)}", flush=True)
        t0 = time.time()
        with open(log, "w") as lf:
            rc = subprocess.run(cmd, stdout=lf, stderr=subprocess.STDOUT).returncode
        secs = round(time.time() - t0)
        rec = {"name": label, "order_dir": out, "seconds": secs, "blender_rc": rc, "log": log}
        final = os.path.join(out, f"{slug}-PRINT.3mf")
        ref = os.path.join(PICKS, d, f"{slug}-PRINT.3mf")
        # Blender exits 0 even when the script raised, so success is the file and its match, never the return code
        tail = open(log, errors="replace").read()[-2500:]
        if not os.path.exists(final):
            rec.update(ok=False, error="no order PRINT.3mf", log_tail=tail)
        else:
            res = compare_print.compare(ref, final)
            json.dump(res, open(os.path.join(out, "print-match.json"), "w"), indent=1)
            rec.update(ok=res["match"], order_file=final, product_file=ref,
                       curr_bed_type=res["order"]["curr_bed_type"],
                       plates=[{"index": p["index"], "name": p["name"], "bed_type": p["bed_type"],
                                "bed_temp_in_gcode": p["bed_temp_in_gcode"], "max_z": p["max_z"],
                                "time_s": p["time_s"], "grams": p["grams"], "printer_model_id": p["printer_model_id"],
                                "objects": [(o["name"], o["settings"], o["part_slots"]) for o in p["objects"]]}
                               for p in res["order"]["plates"]],
                       product_plates=[{"index": p["index"], "name": p["name"]} for p in res["product"]["plates"]],
                       headline_order=res["order"]["headline"], headline_product=res["product"]["headline"],
                       settings_diff=res["settings_diff"], plate_problems=res["plate_problems"],
                       n2s=res["order_printer_model_id_N2S"])
            if not res["match"]:
                rec["log_tail"] = tail
        proof["products"][d] = rec
        proof["at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
        json.dump(proof, open(proof_path, "w"), indent=1)
        print(f"[{d}] {'MATCH' if rec['ok'] else 'FAILED'} in {secs}s: bed {rec.get('curr_bed_type')}, "
              f"{len(rec.get('plates', []))} plate(s)", flush=True)
    bad = [d for d, r in proof["products"].items() if not r.get("ok")]
    print("ALL MATCH" if not bad and len(proof["products"]) == len(ORDERS_TO_MAKE) else f"NOT DONE: {bad or 'some not run'}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
