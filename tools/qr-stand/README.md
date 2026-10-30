# QR counter stand: generator + builder (Earth)

The Custom QR Counter Stand (task deebfdca) is sold on `/business/qr-stand` and edited on
Admin > Orders. The print file is made here, next to the A1s, never on Render.

## Pieces

| file | what it does |
|---|---|
| `gen.py` | One stand: link + words (+ logo) -> Bambu A1 3MF + `-face.png`. Logo is **printed in** (one-colour black silhouette in the ~25 mm centre square); no `--logo` leaves the square blank for a sticker. Refuses a link over 58 bytes (QR v6, level H) with `use a shorter link` (exit 2). Reads its own face back with zxing and writes **no 3MF** if it doesn't match the link (exit 3). |
| `keychain.py` | QR keychain (40 x 56 mm) with a 25 mm NFC tag sealed inside: the whole code raised in black, a 26.5 x 1.6 mm pocket under it, and a **pause** before the layer that covers it (drop the tag in, resume). ~18 min, ~7 g. Reuses `gen.py`. |
| `wrapper/` | A1 project settings (0.20 mm Standard, supports off, white PLA + black PLA). `gen.py` writes them CLI-safe for Earth's Bambu Studio 2.1 command line. |
| `builder.mjs` | Claims builds from the shop's backend (`/api/qr-stand/builder/*`, print-bridge token), runs `gen.py`, posts the 3MF + face + scan result back. Hands "Send to print" requests to the dashboard print queue (`/api/print/*`) when `QR_STAND_SEND_TO_PRINTERS=1`. |
| `test_gen.py` | 11 checks; `QR_STAND_SLICE_TEST=1` also slices a stand on the real CLI and reads the gcode. |

The face colour is a filament change at **6.2 mm** (`Metadata/custom_gcode_per_layer.xml`), the
first layer above the 6 mm plate. Sliced 2026-10-18: filament 1 layers 0-29, filament 2 from
z 6.2, 0 support lines, ~51 g, ~1 h 45 m. Triangle paint (`--paint`) is optional and costs
extra filament swaps.

## Setup on Earth (done 2026-10-18)

```
C:\Python312\python -m venv C:\Users\David\.itp-qr-stand\venv
C:\Users\David\.itp-qr-stand\venv\Scripts\pip install -r tools/qr-stand/requirements.txt
```

Scheduled task **"ITP QR stand builder"** runs `E:\memory\watchtower\scripts\itp-qr-stand-builder.cmd`
every 10 minutes (`builder.mjs --watch 10`, one instance at a time). Log:
`E:\memory\watchtower\projects\imagine-this-printed\qr-stand-builder\builder.log`.
Tokens come from the dashboard repo's `.env.local` (`PRINT_BRIDGE_TOKEN`, `CRON_SECRET`).

## Sending to the printers

The print runner (david-trinidad-com `engine/print-runner.ts`) must slice a ready 3MF as it
stands; that is branch `earth/mason-blaze/qr-stand-project-print`. Until it is merged into the
runner's tree, leave `QR_STAND_SEND_TO_PRINTERS` unset: a stand pushed through the shop presets
gets tree supports grown into its hook slots. After the merge, add
`set "QR_STAND_SEND_TO_PRINTERS=1"` to the launcher.

## By hand

Whole code, no words, bottom 2 in left empty for a nameplate (Darrell's, 2026-10-30):

```
C:\Users\David\.itp-qr-stand\venv\Scripts\python tools/qr-stand/gen.py --url https://darrellmccutchen.com --text "" --full-qr --qr-size 62 --qr-top 6 --clear-bottom 50.8 --out stand.3mf
C:\Users\David\.itp-qr-stand\venv\Scripts\python tools/qr-stand/keychain.py --url https://darrellmccutchen.com --out keychain.3mf
```

The leg was tightened 2026-10-30 (0.1 mm a side in the slot, 0.1 mm lip to skin; it was 0.2 and 0.4 and
rocked). Only the leg changed, so a new leg fits a plate printed before.

```
C:\Users\David\.itp-qr-stand\venv\Scripts\python tools/qr-stand/gen.py --url https://bellascafe.com/menu --text "Scan For Menu" --logo logo.png --out stand.3mf
node tools/qr-stand/builder.mjs --once
```
