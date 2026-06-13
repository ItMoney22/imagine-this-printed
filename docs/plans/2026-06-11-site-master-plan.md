# ImagineThisPrinted — Site Master Plan (2026-06-11)

Source: full-site audit (4 parallel deep audits + mining of `docs/site-audit-findings.md`)
plus David's direct asks: high-end DTF halftones, Saturn 3D-print production trigger,
and a fixed product gallery contract.

Legend: **P0** build now · **P1** next wave · **P2** scheduled · **P3** backlog
Status: ☐ open · ◐ in progress · ☑ done

---

## P0 — Build now (this wave)

### T1 ☑ Product gallery contract — flat lay + ghost mannequin + watermarked design + ONE Mr Imagine
**Landed 2026-06-11** — backend typecheck + frontend build green; pending deploy + live verify.
The flow David called broken. Every published product must end up with exactly this gallery:
1. **Ghost mannequin** (primary)
2. **Flat lay**
3. **Watermarked design** — the design itself, protected with the ITP watermark (`backend/services/watermark.ts`, today only used for 3D concepts)
4. **Mr Imagine mockup — exactly one**

Changes:
- Backend `select-image` + `create-mockups` (`backend/routes/admin/ai-products.ts`): generate a watermarked copy of the selected design → GCS → `product_assets` row (`asset_role='design_watermarked'`, `display_order=4`). Replace any prior one.
- Worker (`backend/worker/ai-jobs-worker.ts`): when saving a mockup asset, delete any existing asset with the same `asset_role` first — one asset per role, ever. Kills mockup accumulation.
- Shared gallery builder (`src/lib/product-gallery.ts`): picks exactly [ghost, flat, mr_imagine ×1, watermarked design], never the raw source. Used by wizard approve (`AdminCreateProductWizard.tsx:317`) and both dashboard publish paths (`AdminDashboard.tsx:978`, `:1086`).
- Mascot-drift guard: flat_lay/ghost_mannequin already run the 2-step Imagen-4-Fast → Nano Banana pipeline with named negative prompts (`backend/services/image-flow/worker-helpers.ts:153-201`). Keep monitoring; if leak persists, add a vision-check + auto-retry on those two slots.

Acceptance: publish any product through wizard or dashboard → `products.images` is exactly 4 URLs in the order above; raw un-watermarked design never appears on the storefront; regenerating mockups never produces duplicates.

### T2 ☑ Real DTF halftone engine (port from Watchtower)
**Landed 2026-06-11** — engine smoke-tested (binary dot screen verified); wizard tool live behind enhance step.
Watchtower's halftone is the real thing — rotated sine-wave dot screen that becomes the
alpha channel, so solid fills print as breathable dots (port of mililili/halftone-converter;
`david-trinidad-com/scripts/halftone_sidecar.py`). ITP's current "halftone" is a fake grain
overlay (`backend/services/dtf-optimizer.ts:70-82`).

Changes:
- `backend/services/halftone.ts` (new): faithful TypeScript port using sharp — levels (black/white point, gamma), optional black-background auto-crop, rotated sine pattern (round/line) or Floyd–Steinberg diffusion, screen → alpha of the original-colored image, PNG out at 300 DPI semantics.
- `POST /api/admin/products/ai/:id/halftone` — runs inline on a chosen asset, uploads result as a new source asset (same pattern as enhance/upscale), returns the new asset.
- Wizard enhance step: "Halftone" tool with frequency (LPI), angle, dot shape, invert-for-dark-shirt controls.

Acceptance: admin can halftone a selected design in the wizard, see before/after, and the halftoned asset flows into mockups + watermarking like any source asset.

### T3 ☑ Saturn production trigger — ordered toys enter the print queue
**Landed 2026-06-11** (ITP side) — queue now emits `line:'catalog-toy'` entries; Saturn-side poller handoff sent.
The print bridge exists (`backend/routes/print-bridge.ts`): Saturn polls `GET /queue`,
reports `POST /status`, status renders in MyOrders. But the queue only carries custom minis
(`3d-print-<modelId>` items). Catalog toys never reach Saturn.

Changes:
- Extend `/queue` to include order items whose product is 3D-printable: category `3d-prints` or `metadata.print3d.enabled`, with `line:'catalog-toy'`, glb/stl from product metadata, product image as reference.
- Cross-Zero handoff to Saturn: bridge now emits catalog toys; confirm poller consumes both line types.

Acceptance: paid order containing a catalog toy appears in the bridge queue within one poll cycle; Saturn status updates render on the customer's order.

---

## P1 — Next wave

### T4 ☑ Wizard draft autosave + resume — **landed 2026-06-11**
Autosaves to localStorage on every change; "Resume draft" banner on reopen rebuilds live
state from the server and lands on the right step. Cleared on Approve / Start Over.

### T5 ☑ AI job failure surfacing + retry — **landed 2026-06-11**
Per-job Retry button on failed job cards in the wizard; backend
`POST /api/admin/products/ai/jobs/:jobId/retry` (worker types re-queue, inline jobs reprocess).

### T6 ☑ Product duplicate — **landed 2026-06-11**
`POST /:id/duplicate` clones product + variants + tags + asset rows as a draft copy;
Duplicate button in the dashboard products table. "Save as template" → P2.

### T7 ☑ Security wave — **landed 2026-06-11** (two items deferred)
- ☑ `AI_WEBHOOK_SECRET` enforced — missing secret rejects webhooks in production
- ☑ Stripe checkout webhook idempotency — atomic `payment_status` claim gates ALL side
  effects; ITC double-deduct on retries is dead
- ☑ Service-role → anon fallback removed in production (6 route files)
- ☑ Per-user rate limits: `/create` 5/min, `/one-shot` 10/min, `/bulk` 2/min
- ☐ Shippo backend proxy → P2 · ☐ legacy Prisma auth removal (`account.ts`) → P2

### T8 ☑ Product text search — **landed 2026-06-11** (name/description/tags filter + clear-search empty state)
### T9 ☑ Tracking numbers + carrier links in MyOrders — **landed 2026-06-11** (UPS/USPS/FedEx auto-detect + Track Package button)

---

## P2 — Scheduled

### T10 ☐ Guest checkout (auth required at every step today; biggest abandonment lever)
### T11 ☐ Variant matrix + inventory — sizes × colors grid, per-cell price/SKU/stock; stock is 0 everywhere today
### T12 ☐ Real-data migrations — founder earnings (fully mock, writes are no-ops), vendor analytics (hardcoded), vendor product submit (doesn't persist), product recommender (real scorer never called), referral leaderboard (fake names)
### T13 ☐ Publishing states — draft → scheduled → active → archived
### T14 ☐ Bulk gen beyond 20 + CSV import; mockups per color in one pass

---

## P3 — Backlog
Reviews/ratings · wishlist + recently-viewed UI (tracking already exists) · abandoned-cart
emails (Brevo wired) · size guides · saved addresses · stock badges + back-in-stock ·
email notification prefs · per-state tax · pagination (catalog + admin lists) · delete
`ProductDesigner.tsx` (1,609 dead lines) · `coupon_usage` recording · kiosk/cost-management
real data.

---

## Decisions needed from David
1. Coupon-on-promo rule: does a % coupon stack on the promo price or the original?
2. `status` vs `is_active`: which is canonical for catalog visibility?
3. Mock features: wire to real data (T12) or visibly label "preview" until then?
4. `ProductPage.tsx:46` still fetches the RAW design (`kind in source,nobg`) for the
   customer "send to design studio" flow. The public gallery is now watermarked, but
   that raw URL is reachable from the product page. Keep (customers need it to
   customize) or proxy it server-side?
