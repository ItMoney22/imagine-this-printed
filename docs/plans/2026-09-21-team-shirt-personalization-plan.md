# Team Shirt Personalization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let a customer type a name and number on a team shirt's product page and get a press-ready 3600x4800 back plate that is exact, free, and identical every time — with an admin screen that turns any future team design into the same kind of template in about three minutes.

**Architecture:** A template lives in `products.metadata.team_template` (no migration). Its two image layers (clean plate, distress mask) are `product_assets` rows using roles absent from the gallery whitelist, so they can never surface on the storefront. One pure function, `renderTeamPlate()`, draws the customer's text as real vector glyphs via opentype.js, composites it onto the plate with sharp, and serves both the 900px live preview and the 3600px print file — the same call at two widths, which is what makes the approved preview and the printed garment the same artifact.

**Tech Stack:** TypeScript, Node/Express (backend), React 19 + Vite (frontend), `sharp` (already a dep), `opentype.js` (new backend dep), GCS via the existing `gcs-storage.ts`, vitest.

**Design doc:** `docs/plans/2026-09-21-team-shirt-personalization-design.md`

---

## Ground rules for the implementer

1. **TDD.** Every task writes the failing test first, watches it fail, then implements. The geometry tasks (3, 4) are pure functions with no I/O — they are where the bugs actually live, so they get the heaviest tests.
2. **Commit after every task.** Small commits; this branch merges within a day per the repo's git discipline.
3. **You are in a worktree** at `D:/Projects for MetaSphere/itp-worktrees/earth/zero-nine/team-shirt-personalization` on branch `earth/zero-nine/team-shirt-personalization`. Never `git checkout` in the shared checkout.
4. **Run tests with** `npx vitest run <path> --reporter=verbose` from the worktree root.
5. **Do not touch** `CLAUDE_TASK.md` — another session (Codex) has uncommitted work there.

---

## Task 1: The shared template type and its validator

The type is shared by frontend and backend, so it goes in `backend/shared/` — the existing convention (`metal-art.ts`, `catalog-capability.ts`, `product-gallery.ts`), which the frontend re-exports.

**Files:**
- Create: `backend/shared/team-template.ts`
- Test: `backend/shared/team-template.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { parseTeamTemplate, sanitizeFieldValue, type TeamTemplate } from './team-template.js'

const TEMPLATE: TeamTemplate = {
  version: 1,
  side: 'back_image',
  plateAssetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  distressAssetId: null,
  canvas: { w: 3600, h: 4800, dpi: 300 },
  halftone: false,
  upcharge: 0,
  fields: [
    {
      key: 'name', label: 'Last name', type: 'text', max: 12, uppercase: true,
      zone: { x: 220, y: 380, w: 3160, h: 900 }, arch: 18,
      font: { family: 'collegiate-slab', src: 'house' },
      fill: '#8C1D2D', strokes: [{ color: '#F2E0BC', w: 26 }], offset: null,
    },
  ],
}

describe('parseTeamTemplate', () => {
  it('accepts a well-formed template', () => {
    expect(parseTeamTemplate(TEMPLATE)).toEqual(TEMPLATE)
  })

  it('returns null for a product with no template', () => {
    expect(parseTeamTemplate(undefined)).toBeNull()
    expect(parseTeamTemplate({})).toBeNull()
  })

  it('rejects a template whose zone escapes the canvas', () => {
    const bad = { ...TEMPLATE, fields: [{ ...TEMPLATE.fields[0], zone: { x: 3500, y: 380, w: 3160, h: 900 } }] }
    expect(parseTeamTemplate(bad)).toBeNull()
  })

  it('rejects a future version rather than guessing at it', () => {
    expect(parseTeamTemplate({ ...TEMPLATE, version: 2 })).toBeNull()
  })
})

describe('sanitizeFieldValue', () => {
  const nameField = TEMPLATE.fields[0]

  it('uppercases and trims a name', () => {
    expect(sanitizeFieldValue(nameField, '  smith ')).toBe('SMITH')
  })

  it('keeps the characters real surnames actually use', () => {
    expect(sanitizeFieldValue(nameField, "o'brien")).toBe("O'BRIEN")
    expect(sanitizeFieldValue(nameField, 'smith-jones')).toBe('SMITH-JONES')
  })

  it('strips characters a press cannot set', () => {
    expect(sanitizeFieldValue(nameField, 'SM<script>ITH')).toBe('SMSCRIPTITH')
  })

  it('truncates at max', () => {
    expect(sanitizeFieldValue(nameField, 'VANDERMEULENSKI')).toBe('VANDERMEULEN')
  })

  it('keeps only digits in a number field, capped at max', () => {
    const numberField = { ...nameField, key: 'number', type: 'number' as const, max: 2, uppercase: false }
    expect(sanitizeFieldValue(numberField, '2x2')).toBe('22')
    expect(sanitizeFieldValue(numberField, '123')).toBe('12')
  })

  it('returns an empty string for a value that sanitizes away entirely', () => {
    expect(sanitizeFieldValue(nameField, '!!!')).toBe('')
  })
})
```

**Step 2: Run it and watch it fail**

Run: `npx vitest run backend/shared/team-template.test.ts`
Expected: FAIL — `Cannot find module './team-template.js'`

**Step 3: Implement**

Write `backend/shared/team-template.ts` exporting:
- `TeamTemplate`, `TeamField`, `Zone`, `Stroke` interfaces exactly as in design doc section 3.
- `TEAM_TEMPLATE_VERSION = 1`.
- `parseTeamTemplate(metadataOrTemplate: unknown): TeamTemplate | null` — accepts either a full product `metadata` object (reads `.team_template`) or a bare template. Returns `null`, never throws, for: missing, wrong version, no fields, a zone whose `x+w > canvas.w` or `y+h > canvas.h`, a non-hex colour.
- `sanitizeFieldValue(field: TeamField, raw: unknown): string` — `text`: strip to `[A-Za-z0-9 '\-]`, collapse whitespace, trim, uppercase when `field.uppercase`, slice to `max`. `number`: strip to `[0-9]`, slice to `max`.
- `sanitizeValues(template, raw): Record<string, string>` — maps every field key through `sanitizeFieldValue`.
- `templateCacheKey(template, values): string` — `sha256` over `version` + each field key/value in `fields` order. **Include the version** so a template edit invalidates derived files with no purge step.

**Why `parseTeamTemplate` returns null rather than throwing:** it runs on every product page load. A malformed template must make the product render as an ordinary shirt, not 500 the page.

**Step 4: Run and verify green**

Run: `npx vitest run backend/shared/team-template.test.ts`
Expected: PASS (13 tests)

**Step 5: Commit**

```bash
git add backend/shared/team-template.ts backend/shared/team-template.test.ts
git commit -m "zero-nine: the team template type, and the rules a customer's text has to survive"
```

---

## Task 2: Text fitting and arch geometry

Pure math, zero I/O. This is where `VANDERMEULEN` overflowing the zone or a lone `1` stretched to 1800px actually happens, so it is tested hardest.

**Files:**
- Create: `backend/services/team-plate/fit.ts`
- Test: `backend/services/team-plate/fit.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { fitToZone, archPlacements } from './fit.js'

// A stand-in metrics source: every glyph is 100 units wide, 100 tall, at unitsPerEm 100.
const metrics = (s: string) => ({ width: s.length * 100, ascender: 100, descender: -20, unitsPerEm: 100 })
const ZONE = { x: 0, y: 0, w: 1000, h: 400 }

describe('fitToZone', () => {
  it('scales a short string up to fill the zone width', () => {
    const fit = fitToZone('AB', ZONE, metrics)           // natural 200 -> 1000
    expect(fit.scale).toBeCloseTo(5, 5)
    expect(fit.width).toBeCloseTo(1000, 5)
  })

  it('scales a long string down so it never exceeds the zone', () => {
    const fit = fitToZone('VANDERMEULEN', ZONE, metrics) // 12 glyphs, natural 1200
    expect(fit.width).toBeLessThanOrEqual(ZONE.w)
  })

  it('is height-limited when the zone is short and wide', () => {
    const short = { x: 0, y: 0, w: 10000, h: 200 }
    const fit = fitToZone('AB', short, metrics)
    // height (ascender-descender = 120) * scale must fit 200 -> scale 1.666, not the width-driven 50
    expect(fit.scale).toBeCloseTo(200 / 120, 5)
  })

  it('centres the string in the zone on both axes', () => {
    const fit = fitToZone('A', ZONE, metrics)
    expect(fit.originX + fit.width / 2).toBeCloseTo(ZONE.x + ZONE.w / 2, 5)
  })

  it('never returns a fit for an empty string', () => {
    expect(fitToZone('', ZONE, metrics)).toBeNull()
  })

  it('keeps a single narrow glyph from being stretched to the full zone', () => {
    // "1" must come out the same height as "88", not 2x as wide per glyph.
    const one = fitToZone('1', ZONE, metrics)!
    const eightEight = fitToZone('88', ZONE, metrics)!
    expect(one.scale).toBeCloseTo(eightEight.scale, 5)
  })
})

describe('archPlacements', () => {
  it('returns one placement per glyph', () => {
    expect(archPlacements('BEAR', 18, 1000)).toHaveLength(4)
  })

  it('is a flat baseline at arch 0', () => {
    const flat = archPlacements('BEAR', 0, 1000)
    expect(flat.every(p => p.rotation === 0)).toBe(true)
    expect(flat.every(p => p.dy === 0)).toBe(true)
  })

  it('is symmetric: first and last glyph mirror each other', () => {
    const arc = archPlacements('BEAR', 18, 1000)
    expect(arc[0].rotation).toBeCloseTo(-arc[3].rotation, 5)
    expect(arc[0].dy).toBeCloseTo(arc[3].dy, 5)
  })

  it('lifts the ends above the centre for a positive arch', () => {
    const arc = archPlacements('BEARS', 18, 1000)
    const centre = arc[2]
    expect(arc[0].dy).toBeLessThan(centre.dy)   // SVG y grows downward: ends sit higher
  })
})
```

**Step 2: Run and watch it fail.** Expected: `Cannot find module './fit.js'`

**Step 3: Implement `fit.ts`**

```ts
export interface Zone { x: number; y: number; w: number; h: number }
export interface StringMetrics { width: number; ascender: number; descender: number; unitsPerEm: number }
export interface Fit { scale: number; width: number; height: number; originX: number; baselineY: number }
export interface GlyphPlacement { index: number; dy: number; rotation: number }

/**
 * Scale a string to fill `zone` without exceeding it on either axis, then
 * centre it. Returns null for an empty string.
 *
 * The scale is min(widthScale, heightScale) — that single `min` is what keeps
 * "1" and "88" the same cap height. Taking the width scale alone would let a
 * one-glyph string balloon to the full zone width and print a number twice the
 * height of its neighbours.
 */
export function fitToZone(text: string, zone: Zone, measure: (s: string) => StringMetrics): Fit | null

/**
 * Place each glyph on a circular arc. `archDegrees` is the total sweep from the
 * first glyph to the last; 0 is a flat baseline and returns zeroed placements.
 *
 * dy is in SVG coordinates (y grows downward), so a positive arch returns
 * NEGATIVE dy at the ends — the ends sit higher than the centre, which is what
 * "BEAR" arched over a number looks like.
 */
export function archPlacements(text: string, archDegrees: number, fittedWidth: number): GlyphPlacement[]
```

Implementation notes for `archPlacements`: treat the fitted width as a chord. For a sweep of `A` degrees, radius `r = fittedWidth / (2 * sin(A/2))`. Glyph `i` of `n` sits at angle `theta_i = -A/2 + A * (i / (n-1))` (guard `n === 1` to a single zero placement). Its `rotation` is `theta_i` in degrees and its `dy` is `r * (cos(theta_i) - cos(A/2))`, negated so the ends rise.

**Step 4: Run and verify green** (10 tests)

**Step 5: Commit**

```bash
git add backend/services/team-plate/fit.ts backend/services/team-plate/fit.test.ts
git commit -m "zero-nine: fit and arch - the one min() that keeps a 1 the same height as an 88"
```

---

## Task 3: The font registry

**Files:**
- Create: `backend/services/team-plate/fonts.ts`
- Create: `backend/assets/fonts/` (the house faces, OFL-licensed `.ttf` files)
- Test: `backend/services/team-plate/fonts.test.ts`
- Modify: `backend/package.json` — add `opentype.js`

**Step 0: Add the dependency**

```bash
cd backend && npm install opentype.js && npm install -D @types/opentype.js
```

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { HOUSE_FONTS, loadFont, missingGlyphs } from './fonts.js'

describe('HOUSE_FONTS', () => {
  it('ships the faces the lettering styles already name', () => {
    const ids = HOUSE_FONTS.map(f => f.id)
    expect(ids).toContain('varsity-block')
    expect(ids).toContain('collegiate-slab')
  })

  it('every house face resolves to a file that exists', async () => {
    for (const face of HOUSE_FONTS) {
      await expect(loadFont({ family: face.id, src: 'house' })).resolves.toBeTruthy()
    }
  })
})

describe('missingGlyphs', () => {
  it('is empty for plain ASCII in a house face', async () => {
    const font = await loadFont({ family: 'varsity-block', src: 'house' })
    expect(missingGlyphs(font, 'SMITH 22')).toEqual([])
  })

  it('names the characters a face cannot set, so template save can warn', async () => {
    const font = await loadFont({ family: 'varsity-block', src: 'house' })
    const missing = missingGlyphs(font, 'MU\u00d1OZ')
    expect(Array.isArray(missing)).toBe(true)
  })
})
```

**Step 3: Implement**

- `HOUSE_FONTS: { id, label, file, sample }[]` — at minimum `varsity-block`, `collegiate-slab`, `brush-script`, `western`, `stencil`, `heavy-sans`, `graffiti`, `blackletter`. Pick OFL faces that match the ids already used in `backend/shared/lettering-styles.ts` (Graduate for varsity, Alfa Slab, Permanent Marker, etc.) and commit the `.ttf` files under `backend/assets/fonts/`.
- `loadFont(spec: { family: string; src: 'house' | string })` — `house` reads from `backend/assets/fonts/`; anything else is a GCS URL, fetched and **cached in-process by URL**. Fetching a font per render would be absurd.
- `missingGlyphs(font, text): string[]` — unique characters whose `font.charToGlyphIndex(ch) === 0`.

**Why coverage is checked at template save, not per render:** a `.notdef` box reaching the press is a ruined garment, but the check is a property of (font, alphabet), not of one order. Checking once at save catches it while someone is looking at the screen.

**Step 5: Commit**

```bash
git add backend/services/team-plate/fonts.ts backend/services/team-plate/fonts.test.ts backend/assets/fonts backend/package.json backend/package-lock.json
git commit -m "zero-nine: the house font set, and a glyph-coverage check that runs while someone is watching"
```

---

## Task 4: The SVG layer builder

Turns fit + arch + colours into an SVG string. Pure, so it is asserted on the markup rather than on pixels.

**Files:**
- Create: `backend/services/team-plate/svg.ts`
- Test: `backend/services/team-plate/svg.test.ts`

**Step 1: The test asserts the two things that silently break**

```ts
import { describe, it, expect } from 'vitest'
import { buildFieldSvg } from './svg.js'

describe('buildFieldSvg', () => {
  it('draws the stroke stack widest-first, then the fill LAST', () => {
    const svg = buildFieldSvg({ text: 'AB', /* ...field with two strokes... */ })
    const order = [...svg.matchAll(/data-pass="([a-z-]+)"/g)].map(m => m[1])
    expect(order).toEqual(['shadow', 'stroke-0', 'stroke-1', 'fill'])
  })

  it('doubles the stroke width, because SVG centres strokes on the path', () => {
    const svg = buildFieldSvg({ text: 'AB', strokes: [{ color: '#fff', w: 26 }], /* ... */ })
    expect(svg).toContain('stroke-width="52"')
  })

  it('never emits paint-order', () => {
    // librsvg's support is inconsistent; a silently-ignored attribute ships
    // un-outlined letters with no error anywhere.
    expect(buildFieldSvg({ text: 'AB' /* ... */ })).not.toContain('paint-order')
  })

  it('emits one path group per glyph when arched', () => {
    const svg = buildFieldSvg({ text: 'BEAR', arch: 18, /* ... */ })
    expect([...svg.matchAll(/<g data-glyph=/g)]).toHaveLength(4)
  })

  it('escapes nothing into the markup from the value itself', () => {
    // Values are already sanitized upstream, but the SVG must be built from
    // GLYPH PATHS, not from a <text> element, so there is no text node to inject into.
    expect(buildFieldSvg({ text: 'AB' /* ... */ })).not.toContain('<text')
  })
})
```

**Step 3: Implement `buildFieldSvg(opts): string`** — for each glyph, get its path from opentype at the fitted scale, apply the glyph's arch `dy`/`rotation` via a `<g transform>`, and emit the four passes as separate `<path d="...">` copies with `data-pass` attributes. Order: shadow (translated by `offset.dx/dy`), strokes widest to narrowest with `stroke-width = 2 * w` and `stroke-linejoin="round"`, then fill.

**Step 5: Commit**

---

## Task 5: renderTeamPlate — the composite

**Files:**
- Create: `backend/services/team-plate/render.ts`
- Test: `backend/services/team-plate/render.test.ts`

**Step 1: Test against real pixels** (sharp is real here; GCS is mocked)

```ts
// Key assertions:
// - output dimensions match the requested width and the template's aspect ratio
// - a pixel sampled inside the name zone is the FILL colour, not the plate
// - a pixel sampled outside both zones is byte-identical to the plate
// - rendering at 900 and at 3600 produces the same image after downscaling
//   (within a small tolerance) -- this is what makes the preview trustworthy
// - the distress mask REMOVES alpha rather than darkening: a masked pixel
//   ends up transparent, not merely a darker maroon
// - ink never crosses the zone bounds, for every name in a 1..12 char corpus
```

**Step 3: Implement**

```ts
export async function renderTeamPlate(
  template: TeamTemplate,
  values: Record<string, string>,
  opts: { width: number }
): Promise<Buffer>
```

Pipeline exactly as design doc section 4. The distress mask composites with `{ blend: 'dest-in' }` onto the **text layer only**, before that layer goes onto the plate — masking the composed plate would eat the artwork too.

**Step 5: Commit**

---

## Task 6: Cache + preview route

**Files:**
- Create: `backend/services/team-plate/cache.ts`
- Create: `backend/routes/team-plate.ts`
- Modify: `backend/index.ts` (mount the router)
- Test: `backend/routes/team-plate.test.ts`

`POST /api/team-plate/preview` — body `{ productId, values }`. Loads the product, `parseTeamTemplate` on its metadata (404 when absent), sanitizes values **server-side**, computes `templateCacheKey`, returns the cached GCS URL when present or renders at 900px and uploads.

Rate-limited (the repo already has `express-rate-limit`), because this is an unauthenticated endpoint that does image work.

**Step 5: Commit**

---

## Task 7: The cart merge key

**The bug this prevents:** a coach adds SMITH 22 in YL, then LOPEZ 41 in YL, and the cart silently shows "qty 2" of SMITH. Both kids get the same shirt.

**Files:**
- Modify: `src/types/index.ts` — `CartItem.personalization?: Record<string, string>`
- Modify: `src/context/CartContext.tsx:238-246` (merge predicate) and `:255-268` (new item), plus the `addToCart` signature at `:116`, `:137`, `:350`
- Test: `src/context/CartContext.personalization.test.tsx`

**Step 1: Write the failing test first — this one matters most**

```tsx
it('keeps two players in the same size as two separate lines', () => {
  // add SMITH/22 YL, then LOPEZ/41 YL
  // expect items.length === 2, each quantity 1
})

it('still merges genuine repeats of the same player', () => {
  // add SMITH/22 YL twice -> one line, quantity 2
})

it('merges ordinary non-personalized products exactly as before', () => {
  // regression guard on the existing behaviour
})
```

**Step 3: Implement** — add `personalizationSignature(item.personalization) === personalizationSignature(personalization)` to the `find` predicate, following the existing `addonsSignature` pattern (stable key order, so `{name,number}` and `{number,name}` hash alike).

**Step 5: Commit**

```bash
git commit -m "zero-nine: two players, two lines - personalization joins the cart merge key"
```

---

## Task 8: Checkout re-renders server-side

**Files:**
- Modify: `backend/routes/stripe.ts` — `replaceOrderItems` (~line 230-275)
- Test: `backend/routes/stripe.personalization.test.ts`

**Step 1: The test that defines the trust boundary**

```ts
it('ignores a client-supplied print_file_url and re-renders from the values', async () => {
  // POST a cart line carrying print_file_url: 'https://evil/anything.png'
  // assert the persisted order_items.metadata.print_file_url is the
  // server-rendered one, derived from templateCacheKey
})

it('re-sanitizes values at checkout rather than trusting the page', async () => {
  // client sends name: 'sm<script>ith' -> stored as 'SMSCRIPTITH'
})

it('writes personalization into order_items.metadata', async () => { /* ... */ })
```

**Step 3: Implement** — in `replaceOrderItems`, when the product has a template, sanitize the submitted values, render/fetch-from-cache at full canvas width, and write `personalization` + `print_file_url` into the row's `metadata`. Mirrors the posture already documented in that file for shipping: the client supplies display values, the server supplies every fact.

**Step 5: Commit**

---

## Task 9: Template authoring service

**Files:**
- Create: `backend/services/team-plate/authoring.ts`
- Test: `backend/services/team-plate/authoring.test.ts`

Three functions:
- `erasePlate(sourceUrl)` — `editOpenAIImage` with a keep-everything-else prompt, then upscale to canvas size. Returns the plate buffer.
- `deriveZonesAndDistress(originalBuf, plateBuf)` — pixel diff, threshold, connected components, discard components under ~0.5% of canvas area (noise from the upscale), return the two largest as candidate zones (top-most = first field) plus the desaturated diff as the distress mask.
- `eyedropColours(originalBuf, zone)` — dominant interior colour as `fill`, then colours by distance-from-centroid rings as the stroke stack.

All three are **suggestions the operator corrects**, so the tests assert shape and ordering (two zones, upper first, mask same dimensions as canvas), not exact pixel values.

**Step 5: Commit**

---

## Task 10: Admin authoring page

**Files:**
- Create: `src/pages/AdminTeamTemplates.tsx`
- Modify: `src/App.tsx` (route, wrapped in `ProtectedRoute` for admin)
- Modify: `backend/routes/team-plate.ts` (template GET/PUT, admin-auth'd)

Layout per design doc section 5: art on the left with draggable zone boxes, field controls on the right, an "Erase sample lettering" button, and — the screen's real job — a live 900px render beside the original for the side-by-side. Uses semantic theme tokens (`bg-bg`, `text-text`, `border-primary`), never hardcoded colours. Waiting states are themed progress bars with stage text, never spinners.

**Step 5: Commit**

---

## Task 11: Product page personalize block

**Files:**
- Create: `src/components/TeamPersonalizePanel.tsx`
- Modify: `src/pages/ProductPage.tsx`

Renders above size/colour when `product.metadata?.team_template` parses. Debounced 400ms preview. **Feature-detects the API** — on a 404 from `/api/team-plate/preview` it hides the whole block and the product sells as an ordinary shirt, because Vercel ships ahead of Render and a form that 404s reads as a broken store. Add-to-cart is disabled until every required field has a value.

**Step 5: Commit**

---

## Task 12: Fulfillment surface

**Files:**
- Modify: `backend/routes/print-bridge.ts` — pass `metadata.print_file_url` through
- Modify: `src/pages/OrderManagement.tsx` — show `SMITH · 22` on the line with a download link

**Step 5: Commit**

---

## Task 13: The review blocklist

**Files:**
- Create: `backend/services/team-plate/blocklist.ts` + test

`reviewFlags(values): string[]` — returns reasons, and checkout **flags the order for review rather than refusing it**. A child genuinely named Dick must not hit an error at the till; a shirt reading something else entirely should not print unseen. Order Management surfaces the flag.

**Step 5: Commit**

---

## Task 14: Author the Spartans template and prove it end to end

Not a code task — the acceptance test. Using the real artwork: erase the plate, nudge the zones, match the fonts, save, then order a shirt as a customer and confirm the 3600x4800 file that lands on the order is the one the preview showed.

**This is the only step that can actually say the feature works.** Everything above it is a claim.
