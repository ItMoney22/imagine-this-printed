# Shipping Station — setup

The packing-table workstation: one screen, one printer, one button. Someone
stands at the table, picks the next paid order, hits **Buy label & print**, and
a 4×6 comes out of the thermal printer with the customer already emailed.

Screen: `https://imaginethisprinted.com/shipping-station` (admin or manager
login). It is also in the account menu as **Shipping Station**.

---

## 1. What the station is

| Piece | What it is |
|---|---|
| Machine | The Omarchy (Arch + Hyprland) box at the packing table |
| Printer | Rollo — or any 4×6 direct-thermal label printer — on USB |
| Labels | 4×6 direct thermal, fan-fold or roll |
| Scale | Optional. Without one the screen defaults to ½ lb per item, which is what the customer was quoted at checkout |

Nothing is installed from this repo on that machine. The station is a web page;
the only local setup is CUPS and the printer.

---

## 2. Print path, and why it is built this way

Two details do the work, and both are easy to get wrong:

1. **The label is bought as `PDF_4x6`.** Shippo's plain `PDF` is a US-Letter
   sheet with the label sitting in one corner — measured on the label bought
   2026-09-12, it came back **8.27in × 10.98in**. A thermal printer cannot crop
   that, so it either prints a shrunken label in the corner or nothing usable.
   `PDF_4x6` makes the PDF's *page* the label. Set with `SHIPPO_LABEL_FORMAT`
   on the API service; unset means `PDF_4x6`.

2. **The label comes back through our own API**
   (`GET /api/orders/:id/shipping-label/file`). Shippo hands out a signed URL on
   `deliver.goshippo.com`, and a browser will not let a page script a
   cross-origin document — so a label opened from that URL can only be printed
   by hand. Served from our origin, the page holds the bytes as a blob and fires
   the print dialog itself. That route also refreshes the link from Shippo if
   the signed URL has expired, so an old order can still be reprinted.

---

## 3. Omarchy (Arch) setup

### CUPS

```bash
sudo pacman -S --needed cups
sudo systemctl enable --now cups.socket
sudo usermod -aG lp,sys "$USER"   # log out and back in after this
```

### Rollo driver

Rollo ships an x86_64 Linux tarball (driver + PPD + their own install notes) on
their Linux driver page — the file is named like
`rollo-driver-ubuntu_x86_64_v1.0.2.tar.gz`. It is a plain tarball, not a `.deb`,
so it installs on Arch the same as anywhere else.

**Install the driver BEFORE plugging the printer in.** If the printer is
detected first, CUPS adds it with a generic driver and the 4×6 media size comes
out corrupted; that is the single most common failure with these printers.

```bash
tar xzf rollo-driver-ubuntu_x86_64_v1.0.2.tar.gz
cd rollo-driver-*
sudo ./install.sh          # follow Rollo's included tutorial
```

Arch users can instead use the AUR package `rollo-printer`, which wraps the same
driver. Either way you end up with the `rastertolabel` filter in
`/usr/lib/cups/filter/` and a Rollo PPD in `/usr/share/cups/model/`.

Now plug in the USB cable and power the printer on.

### Add the printer

Easiest through the CUPS web UI at <http://localhost:631> → Administration →
Add Printer. Or by hand:

```bash
lpinfo -v                                    # find the usb://Rollo/... URI
sudo lpadmin -p Rollo -E -v "usb://Rollo/..." -P /usr/share/cups/model/rollo.ppd
lpadmin -d Rollo                             # make it the system default
```

Set these on the queue (CUPS → Printers → Rollo → Set Default Options):

| Option | Value |
|---|---|
| Media Size | **4x6"** |
| Resolution | 203 dpi |
| Print Quality | Normal |
| Media Tracking | **Gap** (fan-fold and gapped roll stock) |

### Calibrate the label gap

Hold the printer's feed button until it runs a few labels through and stops
cleanly at a label edge. Without this the printer does not know where one label
ends and prints across the gap. Rollo calls this the label learning process.

### Test before trusting it

```bash
lp -d Rollo -o media=w288h432 -o fit-to-page=false /path/to/any-4x6-label.pdf
```

`w288h432` is 4×6 inches in points (4×72 by 6×72). One label, edge to edge, no
white band, nothing cut off.

---

## 4. Browser at the station

Chromium print settings for the station (they stick per printer):

| Setting | Value |
|---|---|
| Destination | Rollo |
| Paper size | 4x6 (Borderless) |
| Scale | **100%** — not "Fit to printable area" |
| Margins | **None** |
| Pages per sheet | 1 |
| Headers and footers | unchecked |
| Background graphics | on |

Give the station its own window instead of a browser full of tabs:

```bash
chromium --app="https://imaginethisprinted.com/shipping-station"
```

On Hyprland, bind that to a key or drop it in `~/.config/hypr/hyprland.conf`
as an `exec-once` so the station comes up on boot.

To skip the print dialog entirely once the printer is proven, launch with
`--kiosk-printing` — every print goes straight to the default printer with no
dialog. Only do this **after** a normal print has come out correct, because with
kiosk printing there is no dialog left to catch a wrong paper size.

---

## 4b. Pluto: printing without a print dialog

Everything above prints from the browser, which means somebody is looking at a
print dialog. The station agent removes that step.

**Pluto** is the packing-table workstation (planets, as always). A small agent
runs there, polls the API for work, and prints it to the Rollo. Buying a label
on the station screen queues a job; the label comes out of the printer a few
seconds later and the screen goes green on its own.

The agent **pulls**. It polls `api.imaginethisprinted.com` over the public
internet with a shared bearer token — the API never dials into the tailnet.
Render is not on the tailnet and does not need to be; Tailscale is how David
reaches Pluto, not how Pluto gets its work. Pulling also means Pluto can be
asleep, rebooted or unplugged without losing anything: the label is already
bought, and the job waits.

### Turning it on

1. Generate one long random secret. Set it as `PRINT_STATION_TOKEN` on the
   Render API service **and** in the agent's config on Pluto. Also set
   `PRINT_STATION_DEFAULT=pluto`.
2. Run the agent on Pluto (systemd service, restart on failure).
3. The station screen's header shows **pluto online** with a green dot once the
   agent has polled within the last 90 seconds.

With `PRINT_STATION_TOKEN` unset there is no station at all, and the screen
prints through the browser exactly as before. That is the fallback, and it is
also what the "Print it in this browser instead" button uses when Pluto is
asleep or the printer jams.

### The contract the agent implements

Auth on all four: `Authorization: Bearer <PRINT_STATION_TOKEN>`.

| Call | Meaning |
|---|---|
| `GET /api/print-station/jobs/next?station=pluto&printer=Rollo&agent=1.0.0` | Claim the oldest queued job. `204` = nothing to do (the usual answer). `200` returns `{ job: { jobId, orderNumber, copies, fileUrl, trackingNumber } }` and the job is now `printing`. |
| `GET /api/print-station/jobs/:jobId/file` | The label bytes — a 4×6 PDF. Re-signs an expired carrier URL, so it works on old orders too. |
| `POST /api/print-station/jobs/:jobId/status` | `{ "status": "printed" }` or `{ "status": "failed", "error": "..." }`. |
| `POST /api/print-station/heartbeat` | `{ "station": "pluto" }` — only needed if the agent stops polling; polling already counts as a heartbeat. |

A failed job stays failed. It is not retried automatically, because a jam or an
empty roll does not fix itself and a retry loop prints a stack of duplicates the
moment someone reloads the labels. Reprint from the screen when it is fixed.

Claiming is guarded server-side, so two agents polling at once cannot both take
the same label.

### Admin view

`GET /api/print-station/stations/pluto` (admin/manager) answers "is Pluto
alive and what is stuck": `online`, `lastSeenAt`, and the queued / printing /
failed counts. That is what the header dot reads. It turns "nothing came out of
the printer" into "Pluto has not called home in twenty minutes".

---

## 5. The daily flow

1. Open the station. The queue is every **paid** order with no label yet, oldest
   first. Unpaid checkout drafts never appear — payment status is the gate.
2. Pick the order. Check the address and what is in the box.
3. **Pick the box it is going in.** This is not optional and nothing is
   pre-selected beyond whatever was used last. Carriers price on dimensional
   weight as well as scale weight — a 16×12×10 box declared as a poly mailer is
   an underpaid label and an adjustment on the invoice weeks later.
4. Weigh the packed box, type the weight. Default is ½ lb per item, the same
   number the customer was quoted at checkout.
5. **Buy label & print.** That buys the cheapest usable USPS/UPS rate for that
   box and weight, marks the order shipped, emails the customer their tracking,
   and sends the label to Pluto (or prints through the browser if no station is
   configured).
6. If the print jams or the roll was bad: **Reprint** in the "Already labelled"
   list. The label lives on the order — a reprint is not a second purchase.

Buying is limited to **admin** and **manager** accounts. A founder can see the
queue but the button is off.

---

## 6. Where the money actually goes

Worth writing down, because it caused a "where did this label come from?" the
first time a label was bought from the site.

- The labels are bought on the Shippo account owned by
  **`admin@nextlevelgrades.com`**. Signing into goshippo.com with any other
  email shows a different, empty account.
- The carriers are **Shippo's own** USPS and UPS accounts
  (`shippo_usps_account`, `shippo_ups_account`), so the label bills to that
  Shippo account's payment method. It appears under Shipping History / Billing,
  not under Orders.
- Every purchase from the site is also recorded in our own `audit_logs` as
  `shipping_label_purchased`, with who clicked it, the carrier, the service and
  the cost. That is the authoritative record if Shippo's UI is confusing.
- Labels bought by hand in the Shippo dashboard do **not** create an audit row
  and do not attach to an order. If you buy one that way, paste the tracking
  number into Order Management so the customer still gets it.

---

## 7. When it goes wrong

| What you see | What it is |
|---|---|
| Nothing printed, screen says done | The browser refused the scripted print. Use "Nothing came out? Open the label" and print that tab. |
| Label prints tiny in a corner | The queue is on Letter/A4, or scale is "fit to page". Media Size 4x6, Scale 100%, Margins None. |
| Prints across the gap, creeps down the roll | Gap calibration was never run. Hold the feed button until it stops at a label edge. |
| "Shippo is not configured on the server" | `SHIPPO_API_TOKEN` is missing on the API service. Nothing was bought — that was a demo label. |
| "No carrier rates available for this address" | Address is bad, or the USPS/UPS carrier accounts in Shippo are disconnected. |
| "Order shipping address is incomplete" | Missing street, city, state or ZIP. Fix it in Order Management first. |
| Order is not in the queue | It is not `paid`, or it already has a label or a tracking number. |
| "Pick a box size before buying the label" | Nothing was selected. Deliberate — a guessed box is an underpaid label. |
| Header says **pluto offline** | The agent is not running or cannot reach the API. Print from the browser meanwhile; the label is still bought. |
| "pluto has not picked this up" | Job queued, agent silent. Use "Print it in this browser instead", then fix the agent. |
| Carrier bills an adjustment after the fact | The declared box was smaller than what shipped. Check `metadata.shipping_label.parcel` on the order against what actually went out. |
| Filter errors in CUPS | Rollo's `rastertolabel` filter is a closed-source binary. Their published one is x86_64 (and a 32-bit ARM build) — it will not run on arm64. |

---

## 8. Related

- `backend/routes/orders.ts` — label purchase, and the label-file route
- `src/pages/ShippingStation.tsx` — the station screen
- `docs/ENV_VARIABLES.md` — `SHIPPO_API_TOKEN`, `SHIPPO_LABEL_FORMAT`

Sources for the Linux/Rollo specifics:
[Rollo on Linux walkthrough](https://eddieabbondanz.io/post/linux/setting-up-a-rollo-thermal-printer-with-linux/),
[Linux Mint forum thread on the X1040](https://forums.linuxmint.com/viewtopic.php?t=437466),
[notes on the Rollo/Beeprt CUPS driver](https://www.tnhh.net/posts/rollo-arm64-driver.html),
[AUR `rollo-printer`](https://aur.archlinux.org/packages/rollo-printer).
