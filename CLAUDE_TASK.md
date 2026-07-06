# Claude Task Brief
## Request
- Finish the T-shirt `print_locations` rollout after Zero Nine shipped the admin multi-select dropdown and admin AI create persistence.
- Watchtower task: `237e822e-d8aa-424b-bdb5-4e4d55210776`.
- Required remaining work: wire the remaining shirt create/update paths, sync Prisma, and verify with typechecks. Do not rework the shipped admin dropdown unless directly needed.

## Repo detection
- JavaScript/TypeScript project with Vite + React frontend and an Express/TypeScript backend in `backend/`.
- Supabase/PostgreSQL database. The live configured DB was checked read-only on 2026-06-29: `products.print_locations` exists as `text[]` with default `'{}'::text[]`, and the `products_print_locations_valid` CHECK constraint exists.
- Root scripts from `package.json`: `npm run typecheck`, `npm run test`, `npm run build`, `npm run lint`.
- Backend scripts from `backend/package.json`: `cd backend && npm run typecheck`, `cd backend && npm run build`.

## Relevant files (Claude MUST read these first)
- `AGENTS.md`
- `CLAUDE.md`
- `TASK_NOTES.md`
- `supabase/migrations/20260629_tshirt_print_locations.sql`
- `src/types/index.ts`
- `backend/routes/admin/ai-products.ts`
- `backend/routes/user-products.ts`
- `backend/routes/admin/user-product-approvals.ts`
- `backend/prisma/schema.prisma`

## Files to edit (STRICT)
- `backend/routes/user-products.ts`
- `backend/routes/admin/user-product-approvals.ts`
- `backend/prisma/schema.prisma`
- `TASK_NOTES.md` (milestone/work-log bullets only)

## Context from scouting
- Already done: `src/types/index.ts` defines `TshirtPrintLocation` and adds `print_locations?` to `Product` and `AIProductCreationRequest`.
- Already done: `src/components/AdminCreateProductWizard.tsx` has the multi-select `Print Locations` dropdown and sends `print_locations` for shirts.
- Already done: `backend/routes/admin/ai-products.ts` `/create` whitelists/dedupes `front_image`, `back_image`, `pocket`, defaults shirt inserts to `['front_image']`, and inserts `print_locations`.
- Still missing: `backend/routes/user-products.ts` `/create` inserts `category: normalized.category_slug` without `print_locations`, so creator-submitted shirts can violate the live CHECK.
- Still missing: `backend/routes/admin/user-product-approvals.ts` `/:id/approve` can set `updateData.category = 'shirts'` for apparel without ensuring `print_locations` has at least one value.
- Still missing: `backend/prisma/schema.prisma` `model Product` has `images`, `category`, etc., but no `printLocations String[] @default([]) @map("print_locations")`.

## Plan (step-by-step)
1) In `backend/routes/user-products.ts`, add a small local helper or constants matching the admin AI route:
   - Valid values: `front_image`, `back_image`, `pocket`.
   - Accept only an array from `req.body.print_locations`.
   - Whitelist and dedupe strings.
   - After `normalized.category_slug` is known, if category is `shirts` and the filtered list is empty, default to `['front_image']`.
   - Include `print_locations` in the `products` insert.
2) In `backend/routes/admin/user-product-approvals.ts`, apply the same whitelist/dedupe behavior to `req.body.print_locations`.
   - Determine the final category that will be written: `metal-art`, `3d-prints`, existing category, or `shirts` fallback.
   - If final category is `shirts`, set `updateData.print_locations` to the filtered request value, or existing `product.print_locations` if valid/nonempty, or `['front_image']`.
   - If final category is not `shirts` and a valid request array was provided, allow updating it; otherwise leave it unchanged.
3) In `backend/prisma/schema.prisma`, add `printLocations String[] @default([]) @map("print_locations")` inside `model Product`, near the other product array/config columns.
4) Keep `src/types/index.ts`, `src/components/AdminCreateProductWizard.tsx`, and `backend/routes/admin/ai-products.ts` unchanged unless typecheck reveals a direct integration issue.
5) Update `TASK_NOTES.md` with one concise milestone/work-log bullet after implementation.

## Acceptance criteria (checkboxes)
- [ ] Creator submissions through `backend/routes/user-products.ts` cannot insert a `shirts` product with empty/missing `print_locations`.
- [ ] Admin approval through `backend/routes/admin/user-product-approvals.ts` cannot activate/finalize an apparel product as `shirts` with empty/missing `print_locations`.
- [ ] Existing non-shirt behavior is preserved.
- [ ] `backend/prisma/schema.prisma` maps `products.print_locations`.
- [ ] Backend typecheck completes with exit code 0.
- [ ] Root typecheck completes with exit code 0 if frontend/types are touched.

## Commands to run
- Backend typecheck: `cd backend && npm run typecheck`
- Root typecheck if frontend/shared types change: `npm run typecheck`
