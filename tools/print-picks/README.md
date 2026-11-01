# ITP print picks: order files (git record)

The five print picks (shadow ornament, name clicker, dino ornament, hoodie pen holder, teacher marker holder) are
made by parametric Blender scripts that run on Saturn. **The live copy is the memory tree**,
`E:/memory/watchtower/assets/itp-print-picks/` (Syncthing; `~/memory/watchtower/...` on Saturn), with the fonts,
STLs, renders and each product's `<slug>-PRINT.3mf`. This folder is the git record of the code, so a wiped box
does not take it with it. Fonts are not copied here (they are in the memory tree and on the fleet branch
`saturn/mason-blaze/20261101-itp-print-picks-blender`).

## A buyer's name: one command (Saturn)

```
~/opt/blender/blender -b -P ~/memory/watchtower/assets/itp-print-picks/2-name-clicker/make_name_clicker.py -- \
    --name SOPHIA --out ~/memory/watchtower/assets/itp-orders/2-name-clicker/SOPHIA --no-render
```

It writes `<slug>-PRINT.3mf` (open it in Bambu Studio and press print), `print-check.json` and `print-match.json`
into the order folder. Same for the other four (`--name "The Garcias"`, `--name MAYA`, `--name LUCAS --number 7`,
`--name "Ms. Rivera"`).

- The order goes down the **same path as the product's PRINT.3mf** (task e912b835, 2026-11-01): `lib/order_print.py`
  copies the product's `print_spec.json`, points every part at this run's STLs (fit-test parts stay the product's),
  swaps the default name in the plate names, runs `lib/print_check.py`, then `lib/compare_print.py` holds the result
  up against the product's PRINT.3mf. A different bed type, setting or plate list stops the run with the difference.
- A buyer's name into the product's own folder is refused: the Products shelf publishes that folder.
- `lib/itp_slice.py` is **not** a print file maker (no bed type = Cool Plate, 35 C; one plate; no N2S stamp).
  print_check imports it as a library.
- Read any sliced file back: `python3 lib/compare_print.py <file.3mf>`; compare two: `... <product> <order>`.
- Prove all five end to end: `python3 lib/prove_orders.py` (writes `assets/itp-orders/_proof/proof.json`).

## Files

| Path | What |
|---|---|
| `lib/order_print.py` | the order path: product spec -> order spec -> print_check -> compare |
| `lib/compare_print.py` | reads a sliced 3mf back (bed, settings, plates); compares two |
| `lib/prove_orders.py` | one new name per product, proof.json |
| `lib/print_check.py` | builds + slices + checks the PRINT.3mf (Saturn's flatpak Bambu Studio, venv) |
| `lib/itp_slice.py`, `lib/itp_lib.py`, `lib/fit_coupons.py` | slicer helpers, geometry/text helpers, fit tests |
| `<n>-<slug>/make_*.py` | each product's model, ends in `order_print.make_print` |
| `<n>-<slug>/print_spec.json` | each product's plates and settings: the one source of truth for its print file |
