# Team shirt personalization — design

> **SUPERSEDED IN PART — 2026-09-23 (task 65d98dd9).** Per-order lettering is no
> longer drawn as vector glyphs. David 2026-09-22: "just have gpt2.5 flare just
> redo the design keeping things intact and just redoin the name and number."
> The resolution objection below is answered by `recraft-crisp-upscale`
> (live: flare base 1232x1536 -> upscale 3285x4096 -> press 3600x4498, edges
> crisp). The pipeline is `backend/services/team-plate/generate.ts` +
> `plate-store.ts`; the vector engine is quarantined in
> `backend/services/team-plate/legacy-vector/`. Templates, zones, review flags
> and the checkout trust boundary described here are unchanged.


**Date:** 2026-09-21
**Author:** zero-nine (Earth)
**Status:** approved by David, ready to implement
**Branch:** `earth/zero-nine/team-shirt-personalization`

---

## 1. The request

David, 2026-09-21:

> "we made this shirt ... we need to add this design to our products but the
> customer should be able to edit the name and number that goes on the back ...
> the flow needs to be there for other team shirts we do since this isnt the
> only shirt we do for sports"

The worked example is a two-sided sports tee: the front is a Spartans crest
(fixed art, never changes), the back is a player plate — `BEAR` arched over a
varsity `9`, on maroon/gold grunge with halftone bleed. Every future team shirt
has the same shape: fixed art plus one or two fields a customer fills in.

So this is not "a product". It is a **template mechanism** that turns any
existing back design into a personalizable one, and the Spartans shirt is its
first tenant.

## 2. The decision that shapes everything: how the text gets drawn

David's opening instinct was to have GPT Image 2.5 replace the lettering per
order ("it can replace it easy by layering it"). We went the other way, and the
reason is resolution arithmetic, not taste.

A 12x16in back print at 300 DPI is **3600x4800 px**. The gpt-image edit endpoint
returns roughly 1024-1536 px. An AI-drawn `SMITH 22` therefore needs a ~3x
upscale to reach the press, and upscaling invented letterforms is precisely
where edges go soft and a `9` stops being a `9`. Layer on ~60s per attempt, a
real API charge per retry, and a model that will occasionally spell `SMTIH` —
and every single order needs a human eyeball before it can print.

**Chosen: a font layer over a clean plate.** The fixed art is stored once with
the sample lettering erased; the name and number are drawn per order as real
vector glyphs at full print resolution. Spelling is exact by construction, cost
per order is zero, latency is ~150ms, and order #200 is pixel-identical to
order #1.

The AI is still used — but **once, at template-authoring time**, to erase the
sample lettering. That is the one place its resolution ceiling does not bite
(see section 5.1).

### Decisions locked with David

| Question | Chosen | Rejected |
|---|---|---|
| Render engine | Font layer on a clean plate | AI edit per order; AI as a per-order fallback |
| Order shape | One cart line = one personalized shirt | Roster grid on day one; single-only forever |
| Authoring UI | Standalone `/admin/team-templates` page | A step inside the Step Flow; hand-written JSON |
| Fonts | House set + optional per-template `.ttf` upload | Upload-required; house-set-only |

The roster grid (a coach pasting 18 players at once) was deliberately deferred.
Because one cart line is one player, a roster grid is later **pure UI sugar**
that produces the exact same lines — it needs no rework of anything below.

## 3. Data model — no migration required

A template is a property of a product, stored in `products.metadata.team_template`
(jsonb, already present). The two image layers become `product_assets` rows.

Two facts from the live schema make this migration-free:

- `product_assets.kind` is plain `TEXT` with **no CHECK constraint**
  (`migrations/2025-11-04-ai-product-builder.sql:51`), so new kinds and roles
  need no DDL.
- `backend/shared/product-gallery.ts`'s `ROLE_ORDER` is a **whitelist**, not a
  sort: a role absent from it is invisible on the storefront no matter what
  publishes the product. This is the same mechanism that already keeps the
  team-only halftoned print file away from customers. New roles are therefore
  safe by default.

```jsonc
products.metadata.team_template = {
  "version": 1,
  "side": "back_image",
  "plateAssetId":    "<product_assets uuid>",  // art with sample lettering erased
  "distressAssetId": "<product_assets uuid>",  // grunge/halftone mask
  "canvas": { "w": 3600, "h": 4800, "dpi": 300 },
  "halftone": false,                            // per-design, not per-order (section 6)
  "upcharge": 0,                                // dollars, per line
  "fields": [
    {
      "key": "name", "label": "Last name", "type": "text",
      "max": 12, "uppercase": true,
      "zone": { "x": 220, "y": 380, "w": 3160, "h": 900 },
      "arch": 18,
      "font": { "family": "collegiate-slab", "src": "house" },
      "fill": "#8C1D2D",
      "strokes": [ { "color": "#F2E0BC", "w": 26 }, { "color": "#FFFFFF", "w": 12 } ],
      "offset": { "dx": 22, "dy": 26, "color": "#C9A227" }
    },
    {
      "key": "number", "label": "Number", "type": "number",
      "max": 2,
      "zone": { "x": 900, "y": 1500, "w": 1800, "h": 2400 },
      "arch": 0,
      "font": { "family": "varsity-block", "src": "house" },
      "fill": "#C9A227",
      "strokes": [ { "color": "#8C1D2D", "w": 34 }, { "color": "#FFFFFF", "w": 14 } ]
    }
  ]
}
```

New `product_assets` roles: `team_plate_back`, `team_distress_back`. An uploaded
`.ttf` goes to GCS and its URL sits in `font.src` (never a `product_assets` row —
it is not an image, and it must never be served to a browser, section 7.6).

**Why `fields` is an array, not a fixed name/number pair.** The next team shirt
may want a first name, a graduation year, or no number at all. A typed array
costs nothing today and means shirt #4 is a template edit rather than a schema
change.

## 4. The render engine

One function, used by both the live preview and the press file:

```ts
// backend/services/team-plate/render.ts
renderTeamPlate(template, values, { width }): Promise<Buffer>
```

Preview and print file are **the same call at different widths**. That identity
is the guarantee that the customer approved exactly what the press receives —
not an approximation of it.

```
"SMITH" + font
   |
   v  opentype.js -> per-glyph vector paths     (no system fonts on Render)
[ fit to zone ]    scale to zone width, clamp on height, apply tracking
   |
   v  arch: place each glyph on a circular arc, rotate to the tangent
[ SVG path set ]
   |
   v  draw back-to-front, one path copy per pass:
      1. offset shadow  (translate dx,dy, fill offset.color)
      2. outer stroke   (stroke-width 2*w -- stroke is centred, half lands outside)
      3. inner stroke
      4. fill
   |
   v  sharp: rasterize SVG -> RGBA
[ text layer ]
   |
   v  distress mask, blend 'dest-in'  -> scratches eat the letters' alpha
   |
   v  composite onto plate at zone origin
[ back-SMITH-22.png  3600x4800 @300dpi ]
```

Two mechanics chosen deliberately:

**Strokes are stacked path copies, not `paint-order`.** librsvg's support for
`paint-order` is inconsistent, and a silently-ignored attribute ships
un-outlined letters with no error anywhere. Drawing the path four times is dull
and always works.

**The distress mask is `dest-in`, not `multiply`.** It knocks holes in the
letters' alpha so the shirt colour shows through the scratches — which is what
the original `BEAR` actually does. `multiply` would merely darken them.

**Caching.** Output is stored in GCS keyed on
`sha256(templateVersion + fieldValues)`. `SMITH 22` is rendered once, ever.
A 900px preview is ~150ms and costs nothing, so it can fire on a debounced
keystroke; because the key includes `templateVersion`, editing a template
invalidates every derived file without a purge step.

## 5. Authoring a template

`/admin/team-templates/:productId`. Four moves, and only the last one has to be
right — the rest are machine guesses the operator corrects.

### 5.1 Get a clean plate

One button, "Erase sample lettering," runs `editOpenAIImage` on the back art
with a keep-everything-else prompt. It returns ~1536px and the plate needs
3600x4800 — but **the plate is splatter and halftone, not letterforms**, and
texture survives a 3x upscale where a `9` does not. That asymmetry is the entire
reason the AI is welcome at this step and banned from the per-order path.

Escape hatch: upload a clean plate directly. Worth trying first — ITP holds
~1,418 design PSDs in GCS, and if this design is among them, hiding two layers
yields a perfect plate with no AI involved at all.

### 5.2 Zones and the distress mask come free from a diff

We hold both the original and the erased plate, so **the pixels that changed are
the lettering**. Diff them, take connected components, and the upper blob seeds
the name zone while the lower seeds the number zone. The same diff, desaturated,
*is* the distress mask — the scratches are lifted off the real `BEAR` rather
than faked from a texture library. The operator nudges boxes; they never draw
them.

### 5.3 Colours are eyedropped

Sample the original lettering: dominant interior colour is `fill`, and the
colour rings outward give the stroke stack in order. Pre-filled and editable.

### 5.4 The side-by-side

Pick a font, type a test name, and watch it render at 900px beside the original
artwork. Save when they match. This comparison is the screen's real job.

## 6. Customer -> cart -> press

**Product page.** When `metadata.team_template` is present, a Personalize block
renders above size/colour, built from `fields`. Debounced 400ms, it POSTs to
`/api/team-plate/preview` and shows the back beside the front mockup. Waiting UI
is a themed progress bar with stage text and elapsed time — never a spinner
(David, 2026-09-02) — though at ~150ms cached, most keystrokes never show one.

**The cart merge trap.** The cart currently merges lines on product + size +
colour. A coach adding `SMITH 22` and then `LOPEZ 41` in the same size would
silently collapse into "qty 2 of SMITH". **Personalization values must join the
merge key.** This is the likeliest bug in the feature and it is invisible until
a real order ships wrong.

**Checkout is a trust boundary.** The client submits *values*, never a file URL.
`backend/routes/stripe.ts` re-validates and re-renders from the template
server-side — the same posture already applied there to shipping, where every
number comes from server pricing and the client supplies only a display label.
The result lands in `order_items.metadata` (jsonb, no migration):

```jsonc
metadata: {
  "personalization": { "name": "SMITH", "number": "22" },
  "print_file_url": "gs://.../team-plates/back-a91f3c.png"
}
```

**Press.** Whether this art wants halftoning is a property of the *design*, not
the order, so `template.halftone` is decided once and `applyHalftone` (the
existing print-prep engine) runs on the rendered plate when set. Order
Management shows `SMITH · 22` on the line with a download link, and
`backend/routes/print-bridge.ts` passes the file through like any other.

**Price.** `template.upcharge` (default `$0`) is added per line, server-side, in
the same place garment tiers and add-ons already apply.

## 7. Failure modes

Ranked by likelihood of reaching a customer.

1. **Cart merge collapse** (section 6). Two players, one size, one line. Pinned
   by test.
2. **Long names.** `VANDERMEULEN` is 12 characters; `BEAR` is 4. Fit is
   per-string: measure, scale to the zone, centre. Property test asserts
   rendered ink never crosses the zone bounds at any length.
3. **Narrow numbers.** `1` and `88` want very different widths. Same fit path,
   separately verified — a `1` stretched to fill its zone looks broken.
4. **Profanity and trademarks on a printed garment.** A blocklist that **flags
   the order for review** rather than hard-failing checkout. A child genuinely
   named Dick must not hit an error at the till.
5. **Apostrophes and diacritics.** A font missing the glyph returns `.notdef`
   and prints a box. Coverage is checked **once at template save**, with a
   warning there — not per order.
6. **Font licensing.** An uploaded `.ttf` must never reach the browser; that is
   redistribution. Rendering is server-side only and the URL stays backend-side.
7. **Deploy skew.** Vercel ships ahead of Render (see the 2026-09-08 incident).
   The personalize block feature-detects the API and hides itself when absent,
   rather than rendering a form that 404s.

## 8. Tests

Following the repo's per-service `.test.ts` convention:

- `backend/services/team-plate/render.test.ts` — golden-image assertions for the
  fill/stroke stack, arch geometry, and distress application.
- Fit property tests — a name corpus (1..12 chars) and a number corpus (0..99),
  asserting ink stays inside the zone and stays centred.
- Font coverage check at template save.
- Cart merge test — two personalizations produce two lines.
- Checkout test — a client-supplied `print_file_url` is **ignored** and
  re-rendered from values.

## 9. Deliberately out of scope

- **Roster grid / bulk paste.** Fast-follow; costs no rework (section 2).
- **Per-order AI fallback.** Rejected. If a design cannot be zoned, it is not a
  template.
- **Front-side personalization.** The mechanism is side-agnostic (`side` is a
  field) but v1 ships `back_image` only.
- **Team colour swaps.** Changing plate colours per customer is a different
  feature and a different pricing conversation.
