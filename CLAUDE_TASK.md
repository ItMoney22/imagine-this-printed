# Claude Task Brief

## Request

Fix Watchtower task `9d366962-82f0-4083-8700-4b770dcca0cf`: a re-shot or design-QA-auto-fixed mockup must replace its superseded photo in the Etsy draft payload. The stale URL currently survives in the frozen `products.images` gallery and is appended after `metadata.etsy_shots.images` by the Etsy publisher.

## Repo detection

- Vite/React/TypeScript storefront with an Express/TypeScript backend and Supabase.
- Etsy draft creation is in `D:/watchtower-dispatch-worktrees/imagine-this-printed/jimmy-phix/prevent-superseded-photo-9d366962-much677c/backend/services/etsy.ts`.
- Step Flow already owns the authoritative approved-shot model and its gallery resolver in `D:/watchtower-dispatch-worktrees/imagine-this-printed/jimmy-phix/prevent-superseded-photo-9d366962-much677c/backend/services/step-flow/shots.ts`.

## Relevant files

- `D:/watchtower-dispatch-worktrees/imagine-this-printed/jimmy-phix/prevent-superseded-photo-9d366962-much677c/backend/services/etsy.ts`
- `D:/watchtower-dispatch-worktrees/imagine-this-printed/jimmy-phix/prevent-superseded-photo-9d366962-much677c/backend/services/step-flow/shots.ts`
- `D:/watchtower-dispatch-worktrees/imagine-this-printed/jimmy-phix/prevent-superseded-photo-9d366962-much677c/backend/services/etsy-model-shots.ts`
- `D:/watchtower-dispatch-worktrees/imagine-this-printed/jimmy-phix/prevent-superseded-photo-9d366962-much677c/backend/services/design-qa-autofix.ts`
- `D:/watchtower-dispatch-worktrees/imagine-this-printed/jimmy-phix/prevent-superseded-photo-9d366962-much677c/backend/routes/admin/ai-products-step-flow.ts`
- `D:/watchtower-dispatch-worktrees/imagine-this-printed/jimmy-phix/prevent-superseded-photo-9d366962-much677c/backend/shared/product-gallery.ts`
- `D:/watchtower-dispatch-worktrees/imagine-this-printed/jimmy-phix/prevent-superseded-photo-9d366962-much677c/backend/services/etsy-update.test.ts`
- `D:/watchtower-dispatch-worktrees/imagine-this-printed/jimmy-phix/prevent-superseded-photo-9d366962-much677c/backend/services/step-flow/shots.test.ts`

## Files to edit (STRICT)

- `D:/watchtower-dispatch-worktrees/imagine-this-printed/jimmy-phix/prevent-superseded-photo-9d366962-much677c/backend/services/etsy.ts`
- `D:/watchtower-dispatch-worktrees/imagine-this-printed/jimmy-phix/prevent-superseded-photo-9d366962-much677c/backend/services/etsy-update.test.ts`
- If a focused publish-image test cannot fit that fixture cleanly, add only `D:/watchtower-dispatch-worktrees/imagine-this-printed/jimmy-phix/prevent-superseded-photo-9d366962-much677c/backend/services/etsy-images.test.ts`.
- Do not edit `products.images` as a secondary, independently maintained gallery unless required for a legacy/manual-image fallback; do not change Etsy listings or production data during verification.

## Plan

1. Trace all publish/re-publish callers of `publishProductToEtsy` and distinguish initial draft creation from existing-listing updates; retain existing copy, variation, and digital-download behavior.
2. Extract a small, testable image resolver in `etsy.ts`. For Step Flow products, query current `product_assets` and resolve the publish gallery from `getStepFlow(product)` plus `buildApprovedGallery(...)`, which already filters tracked roles to the current approved asset IDs and chooses the newest asset per role. This makes `products.images` a storefront snapshot rather than the Etsy source of truth.
3. Preserve the intended Etsy ordering: current active `metadata.etsy_shots.images` first, then the resolved approved mockup gallery. Deduplicate, validate HTTP(S) URLs, and retain the ten-image cap. Do not let the prior `products.images` snapshot reintroduce a superseded URL for a Step Flow product.
4. Define and cover the legacy fallback deliberately: where no usable Step Flow approval state exists, keep the present metadata-plus-`products.images` behavior so manual and pre-Step-Flow listings do not lose gallery photos. Document this branching in the resolver comment/test names.
5. Add mocked-Supabase/fetch regression coverage at the Etsy upload boundary: a re-shot slot has a new approved asset and a stale old URL remains in `products.images`; assert uploads include only the current model/approved distinct mockups and never the stale URL. Add a multi-photo assertion proving distinct approved roles still all upload, plus a legacy fallback assertion if the resolver branches.

## Acceptance criteria

- [ ] A post-replacement Etsy draft/re-publish payload excludes the superseded URL even if it remains in `products.images`.
- [ ] Current approved Step Flow shots and current `metadata.etsy_shots.images` retain their intended order, are deduplicated, and obey the ten-image limit.
- [ ] Valid multi-photo listings retain all distinct approved mockups.
- [ ] Legacy/manual listings without usable Step Flow approval state retain their existing image behavior.
- [ ] The design-QA autofix and manual `redoShot` flow remain compatible: their replacement state is consumed without a second image-state write.
- [ ] No live Etsy call, listing mutation, or production-data migration is performed by tests.

## Commands

- `npm test -- backend/services/etsy-update.test.ts`
- `npm test -- backend/services/step-flow/shots.test.ts`
- `npm run typecheck`
- `git diff --check -- backend/services/etsy.ts backend/services/etsy-update.test.ts backend/services/etsy-images.test.ts`
- `git status --short`
