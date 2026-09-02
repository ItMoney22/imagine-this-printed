# Photo → Printable Product Pipeline (Design)

**Date:** 2026-09-01
**Author:** Zero Nine (Earth)
**Status:** Design — approved architecture, not yet built
**Driver:** David — "a customer sent me a photo and asked me to make this... how do we make stuff our own and functioning correctly"

---

## 1. The problem

A customer sends a photo of a product (the triggering case: a Ghostface-style
shrouded-figure candle holder). We want to go from that photo to:

1. a **printable** model that actually functions as the object, and
2. a **listable** product with real COGS, on ITP / Etsy / Darrell's storefront,
3. that we **own** — no licence or trademark hanging over it.

Today we can do step 1 badly and steps 2–3 not at all.

## 2. What already exists

| Capability | File | State |
|---|---|---|
| Image → 3D mesh (Tripo v2.5, 4 size tiers, face limits, ITC pricing) | `backend/services/tripo3d.ts` | live |
| GLB → STL, mm-scaled, Y-up→Z-up, centred + grounded | `backend/services/glb-to-stl.ts` | live |
| ITP ↔ Saturn print factory seam (Bambu A1s: Batman, Levosa) | `backend/routes/print-bridge.ts` | live — `GET /queue`, `POST /status` only |
| Catalog / Etsy tiers / STL digital download | `backend/routes/storefront.ts`, `backend/shared/etsy-tiers.ts` | live |
| Copyright + AI-disclosure gate | `backend/services/etsy-copyright-gate.ts` | live but **text-only** |
| Vision QA gate pattern to copy | `backend/services/design-qa-gate.ts`, `mockup-qa.ts` | live |

`TASK_NOTES.md` (2026-08-19) already locked the missing piece and never built it:
*"print-economics gate FIRST (volume → filament → COGS, printability/watertight,
base stability), ahead of visual tuning."* This design is that work.

**There is no Blender anywhere in the repo.** Confirmed by search.

## 3. The gap: Tripo makes statues, not fixtures

Point Tripo at the candle photo and you get a *sculpture of a candle holder*.
A candle holder is a **fixture** and has requirements Tripo cannot satisfy from
an image, at any quality tier:

- a dead-flat, level base (bed adhesion, and it must not tip with a 2lb jar on top)
- a platform sized to a **real** jar — the reference is a ~89mm (3.5") 3-wick.
  Off by 3mm and the product does not work.
- ≥2mm wall everywhere; manifold; no self-intersections
- **hollow**. A 200mm solid figure is ~1,270 cm³ ≈ 1.5kg of PLA. Unsellable.
  The same piece as a 2.4mm shell is ~200 cm³ ≈ 250g ≈ $5 of filament.
  Hollowing is the difference between a product and a science project.
- printable overhangs — that shroud is support hell in the wrong orientation

MakerWorld models work because a human did this functional engineering. Raw AI
output skips all of it.

## 4. Architecture: parametric fixture + AI skin

**Split art from function.** Never ask the generator for the functional geometry.

- A **fixture library** (Blender Python) emits mathematically exact, guaranteed-
  printable functional geometry from parameters. `candle_cradle(jar_dia=89,
  height=200, wall=2.4)` produces a correct platform and retaining ring, every
  time, because it is computed, not generated.
- **Tripo** generates only the decorative shell — the character, the drapery,
  the silhouette. This is where uniqueness comes from.
- **Blender** booleans them together and runs print prep.

The fixture guarantees it *functions*. Tripo guarantees it is *ours*. Every
later product type is a new fixture file, not a new pipeline.

### Fixture library (v1)

| Fixture | Key params | Products it unlocks |
|---|---|---|
| `candle_cradle` | `jar_dia`, `platform_h`, `ring`, `wall` | candle holders (the trigger case) |
| `vessel` | `bore_dia`, `depth`, `drain`, `wall` | planters, pen cups, brush pots |
| `slab_foot` | `footprint`, `weight_pocket` | bookends, door stops, sign bases |
| `device_dock` | `device_w`, `device_t`, `cable_slot`, `angle` | phone / controller docks |

Start with `candle_cradle` only. Add fixtures on demand.

### Blender job (headless, `blender --background --python prep.py -- <args>`)

```
1. import Tripo GLB
2. normalise      scale to target height, Z-up, centre XY, ground to Z=0
3. voxel remesh   Remesh modifier, mode=VOXEL, voxel_size ~0.6mm
                  -> GUARANTEES manifold; kills Tripo self-intersections
4. UNION          boolean (solver=EXACT) with the parametric fixture
5. DIFFERENCE     cut plane at Z=0 -> perfectly flat base
6. hollow         Solidify, offset=-1 (inward), thickness=wall
                  + drain/vent hole (required — else trapped air, and the
                  slicer fills the void with infill we are paying for)
7. checks         bmesh: non-manifold edge count == 0
                  bmesh calc_volume() -> mm3 (drives the filament estimate)
                  bbox fits Bambu A1 build volume (256 x 256 x 256mm)
                  base contact area / footprint ratio -> tip-over risk
8. decimate       to tier face limit
9. export         3MF (+ STL for the digital-download tier)
```

Notes on honesty: full **minimum-wall analysis is a hard geometry problem**. We
get it mostly for free because we *construct* the wall with Solidify at a known
thickness — but AI-generated thin fins (a trailing shroud edge) can still come
out under-thickness. The slicer is the real oracle; step 7 is a cheap pre-filter
that rejects obvious failures before we pay for a slice.

## 5. Print economics (the gate that decides if it is a product)

Two tiers of costing, deliberately:

**Cheap estimate (always, in Blender):**
`grams = volume_mm3 / 1000 × 1.24` (PLA density g/cm³) `× infill_factor`
→ `filament_cost = grams × ($/kg ÷ 1000)`.
Rejects absurd models instantly, no slicer needed.

**Truth (slicer CLI, for anything that passes):**

The Bambu Studio CLI was verified present and working on the Earth machine
2026-09-01 (`C:\Program Files\Bambu Studio\bambu-studio.exe --help` returns 95
lines of flags). The relevant ones **all exist**:

```
--slice 0                     slice all plates
--load-settings "machine.json;process.json"
--load-filaments "filament.json"
--export-3mf out.3mf
--export-slicedata <dir>      <-- slicing data, incl. cost figures
--outputdir <dir>
--orient / --arrange / --ensure-on-bed
```

`--export-slicedata` is a better route than the gcode-comment parsing this plan
originally assumed — it is a structured export rather than scraping
`; filament used [g] =` out of a header. **Its exact contents are not yet
verified** (that needs a real STL, which Phase 1 produces); confirm the schema
before building the parser, and keep gcode-comment parsing as the fallback if
slicedata turns out not to carry mass and time.

Either way it yields real grams + real minutes → real COGS:

```
COGS = filament_g × $/g
     + print_hours × machine_rate       (amortised printer + power)
     + labour (removal, cleanup, insert, pack)
     + packaging + shipping
```

Ballpark for the candle holder — 200mm, 2.4mm shell, PLA: **~200–260g
(~$4–5 filament), ~10–14h print.** To be confirmed by an actual slice; the
point is it lands at a sane retail price instead of a mystery.

Feed this into the existing tier/pricing rails rather than inventing new ones.

### Material note (real, and it matters)

PLA softens around 60°C. A **jar** candle is fine in practice — the flame is
contained in glass, up high, and the holder cradles the lower jar. But the safe
build is **PETG** (~80°C) or PLA-HT for anything sold as a candle product, and
the listing must say *jar candles only, no open flame contact, no tea lights
directly on the plastic*. This is a product-safety line, not a nicety.

## 6. Where it runs: Saturn, via an extended print bridge

Blender and the slicer are heavy desktop binaries. The ITP backend is a Node web
service on Render — it must never try to host these. Saturn already has Blender,
the Tripo key, and the printers, and `print-bridge.ts` is already the ITP↔Saturn
seam with working shared-secret auth (`PRINT_BRIDGE_TOKEN`).

Extend the existing bridge — do not build new infrastructure:

```
GET  /api/print-bridge/model-queue          -> prep jobs awaiting Blender
POST /api/print-bridge/model-result         -> Saturn returns artifacts + metrics
     { jobId, status, stlUrl, threeMfUrl, previewUrl,
       metrics: { volumeMm3, grams, printMinutes, bboxMm, manifold,
                  baseContactMm2 },
       qa: { pass, reasons[] } }
```

Auth, idempotency and the status-mirroring pattern all copy `POST /status`,
which already works.

ITP owns the job record and the product; Saturn owns the heavy compute. Same
contract shape the print factory already uses.

## 7. IP: how we actually make it ours

Two separate problems, and re-modelling from a photo solves **neither**:

1. **MakerWorld licences.** Most are CC-BY-**NC** (non-commercial). Regenerating
   the geometry yourself creates a *derivative work* — it does not reset the
   licence.
2. **The character.** Ghostface is a registered trademark and copyrighted
   sculpture owned by Easter Unlimited (Fun World). They enforce aggressively on
   Etsy and Amazon.

Our gate currently catches **neither**: `etsy-copyright-gate.ts` has zero
entries for `ghostface` / `scream` / `fun world`, and it only reads title,
description and tags — **it cannot see a shape at all.**

### The upgrade

- **Denylist:** add the horror/slasher block that is conspicuously missing —
  ghostface, scream, fun world, easter unlimited, michael myers, halloween,
  freddy krueger, jason voorhees, chucky, pennywise, jigsaw, nightmare before
  christmas, jack skellington, beetlejuice, wednesday/addams, stitch.
- **Vision check (the important one):** run the *source photo* and the *final
  render* through a vision model — "does this depict a recognisable copyrighted
  or trademarked character?" Fail-closed, same contract as
  `design-qa-gate.ts`. A text gate can never catch a geometry clone.
- **Provenance:** when a customer supplies a photo, store it and force an
  explicit answer — *original design* or *reference only*. Reference photos of
  branded product go down the interpretation path, never the clone path.

### The interpretation path (this is the actual answer to David's question)

The part that sells is **not** the licence. A hooded, shrouded figure cradling a
candle is an unprotectable form. The protected part is the *face*. So:

- Steer the Tripo prompt away from the protected features — "hooded wraith,
  smooth blank elongated face, hollow eye voids, no branded mask features"
  instead of reproducing the Ghostface mask.
- Result: identical shelf appeal, zero takedown risk, full commercial rights,
  and an asset Darrell can build a brand on.

The customer still gets their candle holder. We get something we own.

## 8. End-to-end flow

```
photo in (customer or admin)
  |
  +-> provenance + vision IP check --fail--> interpretation mode (steer prompt)
        |
        +-> Tripo: decorative shell only
              |
              +-> [Saturn] Blender: remesh -> union fixture -> flat cut -> hollow
                    |
                    +-> geometry QA (manifold, bbox, base, wall)
                          |
                          +-> volume estimate --reject--> back to generate
                                |
                                +-> slicer CLI: real grams + minutes
                                      |
                                      +-> COGS -> price
                                            |
                                            +-> preview render
                                                  |
                                                  +-> ADMIN APPROVES
                                                        |
                                                        +-> catalog / Etsy / Darrell
                                                              |
                                                              +-> order -> print-bridge -> A1s
```

Admin approval stays a hard human gate before anything lists. Everything
upstream is automated.

## 9. Data model

Keep it lean. Fixtures live in **code** on Saturn (they are geometry programs,
not rows). ITP gets one new table:

`model_prep_jobs` — `id`, `source_image_url`, `source_model_id`, `fixture`,
`params jsonb`, `status`, `attempts`, `artifacts jsonb`, `metrics jsonb`,
`qa jsonb`, `ip_check jsonb`, `created_at`, `updated_at`.

Statuses: `queued → generating → prepping → qa → costed → awaiting_approval →
approved | rejected | failed`.

## 10. What will break (call it now)

- **Boolean failures.** EXACT-solver booleans on a messy Tripo mesh fail or
  produce garbage. The voxel remesh *before* the boolean is the mitigation, and
  it is not optional. Expect a real failure rate; the job must retry with a
  finer voxel size and then give up cleanly rather than emit a bad STL.
- **Voxel size is a tradeoff.** Too coarse melts facial detail; too fine
  explodes tri count and RAM. ~0.6mm at 200mm is the starting guess and needs
  tuning per size tier.
- **Thin trailing geometry.** Drapery edges come out under min wall. The
  pre-filter catches some; the slicer catches the rest.
- **Slicer CLI is finicky.** OrcaSlicer's headless flags shift between versions.
  Pin the version and parse gcode comments — do not trust a JSON API that may
  not exist.
- **Tripo is billable and non-deterministic.** `tripo3d.ts` already tracks
  `submitted` to avoid double-charging on retry — preserve that discipline in
  the new job runner.

## 11. Phasing

**Phase 1 — prove the seam (one product).**
`candle_cradle` fixture + `prep.py` + manual invocation on Saturn. Produce one
real, sliced, *printed* candle holder with an original face. No ITP changes yet.
Success = it prints, it stands, the jar fits.

**Phase 2 — automate the bridge.**
`model_prep_jobs` table, `/model-queue` + `/model-result`, Saturn runner loop.

**Phase 3 — economics + gates.**
Volume estimate, slicer costing, geometry QA, IP gate upgrade (denylist +
vision + provenance).

**Phase 4 — listing.**
Preview render → admin approval → catalog / Etsy / Darrell via existing rails.

## 12. Resolved (David, 2026-09-01)

**1. Printer: Bambu A1.** Build volume 256 × 256 × 256mm — a 200mm piece fits
with room. Two constraints follow from it being a **bed-slinger**, not CoreXY:

- Tall, narrow prints ring and wobble because the bed throws mass back and
  forth. A 200mm shrouded figure needs reduced outer-wall speed and
  acceleration, or the drapery shows ghosting. Budget the extra hours — this is
  why the slicer, not the estimator, sets the price.
- **AMS purge changes the economics.** A two-colour print (white mask, dark
  shroud) on AMS lite purges filament at every tool change. Across a 10h print
  that is easily 100–200g of waste — it can *double* filament cost on a piece
  whose whole margin came from hollowing. **Default to single-colour prints with
  the mask as a separate socketed part** (better mask quality too, since it
  prints flat and unsupported). Reserve AMS for small, fast items.

**2. Material: PLA now, PETG optional — do not block on it.**
The jar-candle case is genuinely fine in PLA: the flame sits high, inside glass,
and the holder only cradles the jar's lower half. PLA never gets near its 60°C
softening point. The decision rule:

| Product | Material |
|---|---|
| Holder for a **jar** candle (glass-contained, no direct contact) | **PLA — ship it** |
| Anything with a pillar candle, tea light, or wax/flame touching plastic | **PETG required — do not sell in PLA** |

Ship PLA today with *"fits jar candles only — no open flame or wax contact"* on
the listing. Order PETG only when a product in row 2 is actually wanted.

**3. Multiple sizes — and this is where the fixture architecture pays.**

Size ladder (jar outer diameter), with a `clearance` param (default 1.2mm
radial) so the jar drops in without forcing:

| SKU | `jar_dia` | Fits |
|---|---|---|
| S | 76mm | small single-wick |
| M | 89mm | standard 3.5" |
| L | 104mm | large 3-wick (Bath & Body Works, Yankee) |

**One Tripo call produces all three SKUs.** Generate the decorative shell once,
then boolean it against three different `candle_cradle` params. Three products,
one generation cost, guaranteed-identical styling across the range. This is only
possible because function is computed rather than generated — it is the direct
payoff of the architecture chosen above.

Tipping is the real risk at size L: a 2lb jar sitting 200mm up is a serious
moment arm. Mitigations, in order — base footprint ≥ jar diameter, keep the
hollow shell's mass low, and expose a `weight_pocket` param so the base cavity
can take sand or steel shot before the bottom is capped.

**4. Darrell's storefront is a different product family — see §13.**

## 13. Darrell's line: business/utility products (QR, WiFi, NFC)

David: *"Darrell site there are other items more towards business like QR code
scanners use wifi etc."*

This is **not** the candle pipeline with different art. It is a different class,
and it is closer to shippable:

**No Tripo call at all.** A QR plaque, a WiFi-password sign, a table number, a
"scan to review" stand — these are *generated geometry*. You take a URL or an
SSID, build the QR matrix in code, extrude it, and mount it on a parametric
stand. Asking an image-to-3D model for this would be actively wrong: it would
produce a fuzzy approximation of a QR code, which is to say a non-functional
one. Pure parametric wins on cost, speed, reliability and precision.

**Why it may be the better first proof than the candle holder:**

- no Tripo dependency — no per-generation cost, no non-determinism, no retries
- prints in 30–90 minutes, not 10–14 hours, so iteration is same-day
- proves the fixture library cleanly, with geometry that is *verifiably* correct
- every business needs its own — it is repeatable, personalised revenue rather
  than a one-off novelty

**The rail already exists.** `print-bridge.ts` already carries `magnetSockets`
and `nfcUrl` per product (`metadata.print3d.magnet_sockets`, `.nfc_url`) and has
an `insert_pause` status that emails the print floor to *"add 2 magnets + write
NFC tag"* mid-print. A tap-for-WiFi NFC plaque needs no new factory workflow —
that is built and live.

### The one thing that will kill this product: scannability

A single-colour printed QR code **does not scan.** Cameras need contrast, and
raised grey-on-grey gives them none. Options, best first:

1. **Recessed pocket + contrasting insert** — print the base, pause, drop in a
   contrasting plate. Reuses the existing `insert_pause` rail exactly.
2. **Filament swap at layer change** — one colour change, minimal purge on a
   small flat part. Good on the A1.
3. Raised QR + painted fill — manual, does not scale.

Non-negotiable QA criterion: **an actual phone must scan the printed part**
before the SKU goes live. Also enforce in geometry — quiet zone (≥4 modules of
clear border), minimum module size ~1.6mm so a 0.4mm nozzle resolves it cleanly,
and error-correction level H so a print artefact does not break the code.

### Suggested fixtures for this line

| Fixture | Params | Product |
|---|---|---|
| `qr_plaque` | `payload`, `module_mm`, `quiet_zone`, `insert_depth` | scan-to-review, scan-to-pay, menu |
| `wifi_card` | `ssid`, `password`, `qr`, `text_engrave` | guest WiFi sign (NFC optional) |
| `table_stand` | `angle`, `card_slot`, `weight_pocket` | table numbers, tent cards |

## 15. The conversational front end — mostly already built

David (2026-09-01): *"I want to be able to upload a photo and my agent gets to
work making it the best it can, or I give it an idea of what I want and we talk
it through till we have a finished product, even coming up with blueprints to
follow."*

**Most of this exists.** Do not rebuild it.

### What is already there

`docs/plans/2026-07-31-mr-imagine-conversational-builder-design.md` — the
**Mr. Imagine Conversational Product Builder**, on the unmerged branch
`earth/zero-nine/itp-mr-imagine-studio` (worktree:
`.claude/worktrees/mr-imagine-builder`). It already has:

- a live voice lane, so it is a conversation, not a form
- a step machine — `type → brief → generate → pick → polish → publish` — that
  "knows when things are done" and announces progress instead of being polled
- **a 3D-print lane already wired** to `/api/3d-models/*` → Tripo at a size tier
- tools: `set_product_type`, `set_design_brief`, `generate_designs`,
  `select_design`, `remove_background`, `create_mockups`, `finalize_product`,
  `convert_3d{size_tier}`, `create_watchtower_task`

And **gpt-image-2 is already the default** generate *and* edit model
(`backend/services/image-flow/models.ts:272`, `:470-471`): `unifiedGenAndEdit`,
**accepts up to 10 input images** for compositing, $0.04/image, ~12s. The
`input_images` array is already plumbed in
`backend/services/image-flow/input-builder.ts:27`.

So "talk it through until it's finished" and "draw it with gpt-image-2" are
both standing capabilities today.

### What is genuinely missing — three seams, not a new system

**1. A photo cannot start the 3D lane.**
`set_design_brief{prompt, style?, tone?, ...}` is text-only, and the 3D lane
begins at a text *concept*. David's actual workflow — customer sends a photo —
has no entry point. Needs a `reference_image` on the brief, routed into Tripo's
image-to-3D (which `tripo3d.ts` already does) rather than through text.

**2. There is no blueprint step.** This is the real new idea, and it is a good
one — but only if built correctly:

> **The blueprint must be rendered FROM the fixture params, not imagined.**

A pretty drawing that hallucinates its own dimensions is worse than no drawing,
because it will be trusted. The blueprint is generated *after* `validate()`
returns normalised params, and is annotated with the real numbers — `jar_dia
89mm`, `height 200mm`, `wall 2.4mm`, `base 104mm`, `est. 253g / ~12h`. gpt-image-2
takes the customer's photo as `input_images[0]` plus those figures and renders
an orthographic spec sheet.

Why it earns its place: it is the **cheap review artifact before an expensive
commitment.** A 10–14 hour print and a Tripo charge are worth gating behind a
drawing David or the customer approves in ten seconds. It is also exactly what
Darrell can show a business client before anything is made.

**3. Mr. Imagine's `convert_3d` stops at a raw Tripo mesh.** It has no fixture,
no printability check, no COGS — it hands back a statue. Wiring that tool to the
print factory (§4–§6) is what turns the existing builder into something that
outputs a *product*. **This is the pipeline currently being built; the front end
is waiting for it, not the other way round.**

### Sequencing

None of this changes Phase 1. The factory has to produce a correct part before
a conversation about it means anything. These three seams land in **Phase 4**,
alongside listing — at which point the loop David described closes:

```
photo or idea -> talk it through -> blueprint (real params) -> APPROVE
  -> Tripo shell -> fixture union -> printability + COGS -> mockup -> list -> print
```

## 16. Shell providers — surveyed on Replicate 2026-09-01

David: *"see if there are any models on replicate that will do like real 3d
functioning parts... if we are using a couple routes to complete the task fast."*

### The headline: no CAD model exists

Searches for `cad` and `parametric solid model` against the live Replicate API
returned **cat photos and Whisper variants.** There is no model on Replicate —
and effectively none in the wild — that emits true parametric solid geometry
with exact, trustworthy dimensions.

This is not a dead end; it **confirms the architecture in §4.** A generative
model cannot promise an 89mm bore is 89mm. The fixture library remains the only
way to get functional geometry that is correct by construction. Nothing found
here changes that split.

### Where multiple routes genuinely help: the decorative shell

The shell is exactly where model choice matters, and Replicate has strong
options. All of them emit **GLB** — the same format Tripo returns — so they drop
into `glb-to-stl.ts` and the Blender runner with **zero new plumbing.**

| Model | Runs | Why it matters here |
|---|---|---|
| `tencent/hunyuan-3d-3.1` | 128k | **`generate_type: "Geometry"` returns an untextured white model.** We print in single-colour PLA and throw textures away — so this is a better fit than Tripo, not just an alternative. `face_count` 40k–1.5M (default 500k). Takes **either** `image` **or** `prompt`. |
| `firtoz/trellis` | 883k | Most-used 3D model on the platform. Takes an **array** of images — if a customer sends three angles, reconstruction improves materially over single-view. `mesh_simplify` built in. |
| `tripo3d` (current) | — | Already integrated, tiered, billed, with the `submitted` double-charge guard. Keep as default until another proves better on real parts. |

Two things make hunyuan worth trialling first: Geometry mode skips texture work
we discard anyway (faster and cheaper per call), and its minimum `face_count` of
40,000 happens to equal our `medium` tier limit — denser input also *improves*
the voxel remesh in step 3, since remeshing degrades gracefully from more detail,
not less.

`hunyuan` accepting a **text prompt** as an alternative to an image also serves
David's second entry route directly — *"or I give it an idea of what I want"* —
without a separate integration.

### Field test 2026-09-01 — what actually happened when we generated a shell

Ran the real thing end to end. Three corrections to the table above:

**1. `hunyuan-3d-3.1` FAILED — do not make it the default yet.**

```
status: failed
error : API Error (ResourceInsufficient): Resources are insufficient.
```

That is Tencent's own upstream error surfacing through Replicate, not a bad
request. The model that looked best on paper (Geometry mode, no wasted texture
work) is **capacity-constrained and cannot be relied on**. Failed predictions
are not billed. Keep it as an option, gate it behind a fallback, and never make
it the only route.

**2. `firtoz/trellis` worked — but needs the VERSIONED endpoint.**
`POST /v1/models/firtoz/trellis/predictions` returns **404**; that model-scoped
route only serves Replicate "official" models. Community models require
`POST /v1/predictions` with `{"version": "<latest_version.id>"}`. This will bite
anyone wiring a provider abstraction who assumes one endpoint shape.

**3. Raw generative output is badly non-manifold — measured, not assumed.**

```
tri_count           39,434
non_manifold_edges  15,658     <-- from a clean, well-lit reference image
bbox (GLB units)    0.55 x 0.57 x 1.00
```

**15,658 bad edges.** An EXACT boolean against that produces garbage or fails
outright. This is the hardest evidence yet that `voxel_remesh()` before any
boolean (§4 step 3) is not a precaution — it is the only reason the union works
at all.

**The route that worked**, and it is the one to build on:

```
text prompt -> gpt-image-2 (~$0.04, first try) -> reference image
            -> trellis (versioned endpoint)    -> GLB shell
            -> voxel remesh -> union with fixture
```

Going through an image is not a detour. It mirrors the real workflow (a customer
sends a photo), it gives a cheap human-reviewable checkpoint before paying for
3D, and it let us steer the character deliberately: the generated wraith has a
**smooth blank featureless face** — §7's interpretation path, executed. Original
IP, no Ghostface, no takedown risk.

### Part-aware generation — real, but not yet

Three models decompose an object into separate parts from one image:
`fire/part-crafter` (`num_parts`), `ayushunleashed/partpacker`, `hcl14/omnipart`.

This maps temptingly onto the §12 recommendation to print the mask as a separate
socketed piece. **Do not build on them yet:** 178, 104 and 164 lifetime runs
respectively. That is research-grade, not production. Revisit once the factory is
working; splitting parts is a solved problem in Blender with a boolean anyway.

### What this changes in the build

Add a **shell-provider abstraction** — one interface, several backends, chosen
per job with fallback:

```
ShellProvider.generate(image? | prompt?, face_limit, seed) -> GLB path
   tripo    (default, integrated)
   hunyuan  (Geometry mode - trial as primary for print work)
   trellis  (multi-image, when the customer sends several angles)
```

Cheap to add because it is one seam over an existing call, and it means a failed
or poor generation retries on a different engine instead of dead-ending the job.
It is **not Phase 1** — the fixture and the QA gate come first, and the provider
swap is meaningless until we can measure which engine yields better *printable*
parts. Phase 3, alongside the economics gate that can actually score them.

## 17. Open questions

1. For Darrell — does the QR line list under his brand, ITP's, or both?
2. Does he want NFC tap in v1, or QR-only first (NFC adds a consumable + a
   write step on the floor)?
3. `earth/zero-nine/itp-mr-imagine-studio` is still unmerged and needs
   `XAI_API_KEY` + `WATCHTOWER_INTERNAL_SECRET` on Render. Merging it is a
   prerequisite for Phase 4 — worth doing before the factory lands so the two
   halves meet.
