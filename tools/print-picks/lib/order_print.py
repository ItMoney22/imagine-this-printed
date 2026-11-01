#!/usr/bin/env python3
"""A buyer's print file for an ITP print pick, made the same way as the product's PRINT.3mf.

Every make_*.py ends here (task e912b835, 2026-11-01). Before, a new name was sliced through
itp_slice.py, and read back out of the files that gave: Cool Plate (vendor default, a 35 C bed: the
first layer lifts on our PEI plates), 0.20 mm Standard where the product prints 0.16 mm, 2 walls not
3, no ironing, the classic wall generator, every colour on ONE plate instead of the product's plate
split, the generic start gcode (no A1 purge line) and an empty printer_model_id, which the A1 refuses.
The product's <slug>-PRINT.3mf came from print_check.py on its print_spec.json, so an order now goes
down that very path:

  1. the product's own print_spec.json is copied into the order folder, every part re-pointed at the
     STL this run just wrote (fit-test parts stay the product's own), the default name in the plate
     and object names swapped for the buyer's;
  2. print_check.py builds and slices it (Textured PEI Plate, the product's process and overrides,
     per-object settings, every plate, N2S stamped) and checks it layer by layer;
  3. the result is read back and held up against the product's PRINT.3mf (compare_print.py). Any
     difference in bed type, settings or plates stops the run with the difference printed, so a file
     that drifted from the product never reaches the printer quietly. The verdict is print-match.json.

There is no settings list in here to fall out of step: change a product's print_spec.json (or
print_check.SHOP) and its next order follows.

From a make script (Blender's Python is fine: this file is stdlib only; print_check runs in its venv):
    import order_print
    order_print.make_print(HERE, A.out, rename={"EMMA": name}, colors=[...], started=T0)
By hand:
    python3 order_print.py <product_dir> <order_dir> [--rename OLD=NEW ...] [--colors "#hex,#hex"]
"""
import copy, json, os, re, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import compare_print  # noqa: E402

PRINT_CHECK = os.path.join(HERE, "print_check.py")
VENV_PY = os.path.expanduser("~/.local/share/itp-print-check/venv/bin/python")
SHARED_PREFIXES = ("fit-coupon/",)  # parts every order reuses from the product folder, unchanged


def check_python():
    py = os.environ.get("ITP_PRINT_CHECK_PY") or VENV_PY
    if not os.path.exists(py):
        raise RuntimeError(
            f"print_check's Python is missing ({py}). Install it once ($0):\n"
            "  python3 -m venv ~/.local/share/itp-print-check/venv && \\\n"
            "  ~/.local/share/itp-print-check/venv/bin/pip install numpy pillow trimesh shapely scipy rtree\n"
            "or point ITP_PRINT_CHECK_PY at a Python that has them.")
    return py


def refuse_product_folder(product_dir, order_dir, is_default):
    """call right after argparse, before anything is written: a buyer's name run into the product's own
    folder would overwrite the STLs, PRINT.3mf and print-check the Products shelf publishes"""
    if not is_default and os.path.realpath(product_dir) == os.path.realpath(order_dir):
        raise SystemExit("a buyer's name needs its own folder: add --out <order folder> "
                         "(e.g. assets/itp-orders/<slug>/<name>); the product folder is the shelf's copy")


def _renamer(rename):
    """one pass, longest key first, so 'DAVID 22' -> 'MAYA 7' is never re-hit by 'DAVID' -> 'MAYA'"""
    table = {k: v for k, v in (rename or {}).items() if k}
    if not table:
        return (lambda s, hits: s), table
    rx = re.compile("|".join(re.escape(k) for k in sorted(table, key=len, reverse=True)))

    def apply(s, hits):
        def sub(m):
            hits.add(m.group(0))
            return table[m.group(0)]
        return rx.sub(sub, s)
    return apply, table


def order_spec(product_dir, order_dir, rename=None, colors=None, started=None):
    """-> the order's print spec (dict). Raises on anything that would make a wrong file."""
    product_dir, order_dir = os.path.abspath(product_dir), os.path.abspath(order_dir)
    spec = json.load(open(os.path.join(product_dir, "print_spec.json")))
    out = copy.deepcopy(spec)
    apply, table = _renamer(rename)
    hits = set()
    for p in out["plates"]:
        # the CLI drops a plate name that holds a colon: the marker holder's PRINT.3mf has three blank
        # plate names, all three were "...(AMS set 1: ...)", and its colon-free fit-test plate kept its name
        p["name"] = apply(p["name"], hits).replace(": ", " - ").replace(":", " ")
        for o in p["objects"]:
            o["name"] = apply(o["name"], hits)
            for part in o["parts"]:
                rel = part["stl"]
                if rel.startswith(SHARED_PREFIXES):
                    src = os.path.join(product_dir, rel)
                    if not os.path.exists(src):
                        raise RuntimeError(f"shared part {rel} is missing from the product folder {product_dir}")
                    part["stl"] = src
                    continue
                src = os.path.join(order_dir, rel)
                if not os.path.exists(src):
                    raise RuntimeError(f"this order has no {rel} (expected at {src}); the make script did not write it")
                if started is not None and os.path.getmtime(src) < started - 2:
                    raise RuntimeError(f"{src} is older than this run: it belongs to an earlier name, not this one")
    missing = sorted(set(table) - hits)
    if missing:
        raise RuntimeError(f"the default name text {missing} is no longer in {product_dir}/print_spec.json's plate or "
                           "object names; update the make script's rename map")
    if colors:
        colors = [c.upper() for c in colors]
        if len(colors) != len(spec["colors"]):
            raise RuntimeError(f"{len(colors)} colours given, the product prints with {len(spec['colors'])}")
        names = list(out.get("color_names") or spec["colors"])
        for i, (old, new) in enumerate(zip(spec["colors"], colors)):
            if old.upper() != new:
                names[i] = f"{new} (buyer's colour; product default {old})"
        out["colors"], out["color_names"] = colors, names
    out["_order"] = {"product_dir": product_dir, "renames": table, "made_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                     "how": "order_print.py (task e912b835): product print_spec.json -> print_check.py"}
    return out


def make_print(product_dir, order_dir, rename=None, colors=None, started=None, verify=True):
    """build, slice and check the order's PRINT.3mf; returns its path. Raises if it does not match the product."""
    product_dir, order_dir = os.path.abspath(product_dir), os.path.abspath(order_dir)
    spec0 = json.load(open(os.path.join(product_dir, "print_spec.json")))
    same = os.path.realpath(product_dir) == os.path.realpath(order_dir)
    if same:
        changed = any(k != v for k, v in (rename or {}).items()) or \
            (colors and [c.upper() for c in colors] != [c.upper() for c in spec0["colors"]])
        if changed:
            raise RuntimeError("an order would overwrite the product's own PRINT.3mf and shelf files: "
                               "pass --out <order folder> (e.g. assets/itp-orders/<slug>/<name>)")
        spec_path = os.path.join(product_dir, "print_spec.json")  # a re-run of the product itself
    else:
        os.makedirs(order_dir, exist_ok=True)
        spec_path = os.path.join(order_dir, "print_spec.json")
        json.dump(order_spec(product_dir, order_dir, rename, colors, started), open(spec_path, "w"), indent=1)
    py = check_python()
    subprocess.run([py, PRINT_CHECK, spec_path], check=True)
    final = os.path.join(order_dir, f"{spec0['slug']}-PRINT.3mf")
    if not os.path.exists(final):
        raise RuntimeError(f"print_check finished but {final} is not there")
    if verify and not same:
        ref = os.path.join(product_dir, f"{spec0['slug']}-PRINT.3mf")
        if not os.path.exists(ref):
            print(f"order_print: no product PRINT.3mf at {ref} to hold this one against (not print-checked yet)")
            return final
        res = compare_print.compare(ref, final)
        if colors:  # another colour changes the purge volumes between colours; nothing else may move
            res["settings_diff"].pop("flush_volumes_matrix", None)
            res["match"] = not res["settings_diff"] and not res["plate_problems"] and \
                res["order"]["curr_bed_type"] == "Textured PEI Plate" and res["order_printer_model_id_N2S"]
        json.dump(res, open(os.path.join(order_dir, "print-match.json"), "w"), indent=1)
        if not res["match"]:
            raise RuntimeError("the order's PRINT.3mf does not match the product's, do not print it:\n" +
                               json.dumps({"settings_diff": res["settings_diff"], "plate_problems": res["plate_problems"],
                                           "curr_bed_type": res["order"]["curr_bed_type"],
                                           "N2S": res["order_printer_model_id_N2S"]}, indent=1)[:4000])
        print(f"order_print: {final} matches {ref}: {res['order']['curr_bed_type']}, "
              f"{len(res['order']['plates'])} plate(s), same settings")
    return final


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("product_dir")
    ap.add_argument("order_dir")
    ap.add_argument("--rename", action="append", default=[], help="OLD=NEW, the default name text in plate names")
    ap.add_argument("--colors", default=None)
    ap.add_argument("--spec-only", action="store_true", help="write the order's print_spec.json and stop")
    a = ap.parse_args()
    rn = dict(r.split("=", 1) for r in a.rename)
    cols = [c.strip() for c in a.colors.split(",")] if a.colors else None
    if a.spec_only:
        print(json.dumps(order_spec(a.product_dir, a.order_dir, rn, cols), indent=1))
    else:
        print(make_print(a.product_dir, a.order_dir, rn, cols))
