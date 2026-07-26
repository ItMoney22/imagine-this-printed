# Claude Task Brief
## Request
- Implement an ACP/OpenAI product feed for ChatGPT Shopping for `imagine-this-printed`.
- Watchtower task ID for traceability: `4c595f13-f3d3-47db-9ed1-50ecab9c5f18`.
- Codex scouting only modified this task brief and `TASK_NOTES.md`; Claude is approved to make the implementation edits listed below.

## Repo detection
- JavaScript/TypeScript project with a Vite + React frontend and an Express/TypeScript backend in `backend/`.
- Backend entrypoint: `backend/index.ts`; routes are mounted with `app.use(...)`.
- Supabase service-role backend client: `backend/lib/supabase.ts`.
- Public product pages use `/product/:idOrSlug`; `src/pages/ProductPage.tsx` accepts UUID or `products.slug`.
- Public catalog liveness gate is `products.status = 'active'` and `products.is_active = true`.
- Product data source is the Supabase `products` table: relevant columns include `id`, `slug`, `name`, `description`, `price`, `images`, `category`, `status`, `is_active`, `stock_quantity`, `in_stock`, `sizes`, `colors`, `meta_title`, `meta_description`, `search_keywords`, `alt_text`, `metadata`.
- Policy routes already exist in the SPA: `/privacy`, `/terms`, `/returns`.
- Commands from repo sources:
  - Root `package.json`: `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test`.
  - Backend `backend/package.json`: `npm --prefix backend run typecheck`, `npm --prefix backend run build`, `npm --prefix backend run dev`.

## Relevant files (Claude MUST read these first)
- `AGENTS.md`
- `CLAUDE.md`
- `CLAUDE_TASK.md`
- `TASK_NOTES.md`
- `package.json`
- `backend/package.json`
- `backend/index.ts`
- `backend/lib/supabase.ts`
- `backend/routes/storefront.ts`
- `backend/routes/seo.ts`
- `api/product-meta.mjs`
- `src/pages/ProductCatalog.tsx`
- `src/pages/ProductPage.tsx`
- `src/types/index.ts`
- `supabase/migrations/001_initial_schema.sql`
- `supabase/migrations/20260706_product_seo_columns.sql`
- `supabase/migrations/20260710_merch_studio_storefront.sql`

## Files to edit (STRICT)
- `backend/routes/feeds/acp.ts` (new)
- `backend/index.ts` (mount the feed route only)
- `backend/package.json` (add a focused validation script only if you create one)
- `backend/scripts/validate-acp-feed.ts` (new, optional but preferred for schema validation)
- `TASK_NOTES.md` (append one concise milestone/work-log bullet after implementation)
- Do not edit frontend pages unless a validation or URL issue proves it is required; if required, update `TASK_NOTES.md` scope first with the exact file and rationale.

## Context from scouting
- Official OpenAI file-upload docs (checked 2026-07-26): product feeds are full snapshot uploads, pushed to OpenAI via SFTP; supported formats include `parquet`, `jsonl.gz`, `csv.gz`, and `tsv.gz`; stable filenames should be overwritten on refresh; start with a small sample and validate all required fields.
- Official OpenAI stable flat-file field names differ from the task wording:
  - Task `id` maps to stable `item_id`; ACP JSON schema product also uses `id`.
  - Task `link` maps to stable `url`; ACP JSON schema product/variant also uses `url`.
  - Task `image_link` maps to stable `image_url`; ACP JSON schema uses `media: [{ type: "image", url }]`.
  - Task `enable_search=true` maps to stable `is_eligible_search=true`.
  - Task `enable_checkout=FALSE` maps to stable `is_eligible_checkout=false`; emit lower-case `false` if using stable flat-file fields because OpenAI validation rules require lower-case strings.
- ACP repo `agentic-commerce-protocol/spec/2026-04-17/json-schema/schema.feed.json` (checked 2026-07-26) is not the same flat schema as the OpenAI stable file-upload docs. It defines a JSON API feed bundle:
  - `$defs.ProductsResponse` requires `products`.
  - `$defs.Product` requires `id` and `variants`.
  - `$defs.Product` properties: `id`, `title`, `description`, `url`, `media`, `variants`.
  - `$defs.Variant` requires `id` and `title`; useful properties include `description`, `url`, `price`, `availability`, `categories`, `condition`, `variant_options`, `media`, `seller`.
- Implement the local endpoint against the ACP 2026-04-17 JSON schema, and include a clearly named stable flat-file export if useful for Merchant portal upload. Do not force old field aliases into the ACP schema object; it has `additionalProperties: false`.
- Recommended public endpoint: `GET /api/feeds/acp/products.json`, mounted by `backend/index.ts` as `app.use('/api/feeds', acpFeedsRouter)`.
- Recommended optional flat export: `GET /api/feeds/openai/products.jsonl` or `GET /api/feeds/openai/products.tsv`, if Merchant portal asks for stable file-upload format instead of the ACP JSON API shape.
- Use the same product liveness gate as public catalog/storefront: `status='active'` AND `is_active=true`.
- Exclude products with no usable public HTTPS image unless you intentionally mark them not searchable; feed quality ranking will suffer on missing media.
- Use `https://www.imaginethisprinted.com` as the public site base unless a deployment env such as `FRONTEND_URL`, `VITE_SITE_URL`, or `PUBLIC_SITE_URL` is already available and valid.
- Required policy URLs:
  - Return policy: `https://www.imaginethisprinted.com/returns`
  - Privacy policy: `https://www.imaginethisprinted.com/privacy`
  - Terms: `https://www.imaginethisprinted.com/terms`
- Seller/brand defaults:
  - Brand/seller name: `Imagine This Printed`
  - Condition: `new`
  - Target country: `US`
  - Currency: `USD`
  - Checkout eligibility: disabled initially.

## Plan (step-by-step)
1. Add `backend/routes/feeds/acp.ts`.
   - Query active products from Supabase using service-role client.
   - Select only fields needed for the feed.
   - Normalize product rows into ACP schema objects with `products[]`.
   - Each product should include `id`, `title`, `description`, `url`, `media`, and at least one variant.
   - Each variant should include stable `id`, `title`, `description`, `url`, `price: { amount, currency: "USD" }`, `availability`, `condition: ["new"]`, `media`, `seller`, and variant options for size/color when present.
2. Map source data conservatively.
   - `id`: `products.id`
   - `title`: prefer `meta_title`, then `name`
   - `description.plain`: prefer `meta_description`, then `description`, stripped to plain text
   - `url`: `/product/${slug || id}` on the public site base
   - `media`: image URLs from `products.images`, filtered to public HTTP(S), first image first, with `alt_text` from `alt_text || name`
   - `price.amount`: integer cents from `products.price`
   - `availability.status`: `in_stock` when `is_active !== false`, `status === 'active'`, and either inventory is not tracked or stock is positive; else `out_of_stock`
   - `availability.available`: boolean matching the status above
   - `categories`: merchant category path from `category`
   - `seller.links`: include `refund_policy`, `privacy_policy`, and `terms_of_service`.
3. Add a stable OpenAI flat-file export only if it stays small and focused.
   - Include required stable OpenAI fields: `is_eligible_search`, `is_eligible_checkout`, `item_id`, `title`, `description`, `url`, `image_url`, `price`, `availability`, `brand`, `condition`, `seller_name`, `seller_url`, `return_policy`, `seller_privacy_policy`, `seller_tos`.
   - Set `is_eligible_search` to `true`.
   - Set `is_eligible_checkout` to `false`.
   - Preserve the task wording in comments/docs as a mapping note, not as non-schema JSON fields.
4. Mount the route in `backend/index.ts`.
5. Add a validation script if practical.
   - Fetch the official schema from `https://raw.githubusercontent.com/agentic-commerce-protocol/agentic-commerce-protocol/main/spec/2026-04-17/json-schema/schema.feed.json` or vendor a tiny validation target in-memory.
   - Validate the route output against `$defs.ProductsResponse` using the repo's existing package constraints. If adding a validator dependency would be too much, write a structural validator that checks required shape and document why full JSON Schema validation was not added.
6. Register/deploy path.
   - Do not claim Merchant portal registration is complete unless you actually have portal access and a successful registration response.
   - If portal access is unavailable, leave the endpoint and validation complete, then file a board follow-up for Merchant portal registration with the endpoint URL, expected format, cadence, and feed flags.

## Acceptance criteria (checkboxes)
- [ ] `GET /api/feeds/acp/products.json` returns HTTP 200 JSON with `{ "products": [...] }`.
- [ ] The generated JSON validates against ACP `spec/2026-04-17/json-schema/schema.feed.json` `$defs.ProductsResponse`, or the validation gap is explicitly documented with a focused structural verifier.
- [ ] Every included product has a stable ID, title, plain description, canonical product URL, at least one image/media URL, USD price in minor units, availability, brand/seller identity, new condition, and policy links.
- [ ] Search is enabled semantically for the feed.
- [ ] Checkout is disabled semantically for the initial feed.
- [ ] Feed generation uses live `products` table data and the same `status='active'` + `is_active=true` liveness gate as the storefront.
- [ ] Products with missing price, missing title, or no usable public image are excluded or marked unavailable in a documented way.
- [ ] Backend typecheck passes.
- [ ] Merchant portal registration is either completed and documented, or a Watchtower follow-up/approval task is filed because credentials/portal access are missing.

## Commands to run
- `npm --prefix backend run typecheck`
- `npm --prefix backend run build`
- If a validation script is added: `npm --prefix backend run validate:acp-feed`
- Optional local smoke:
  - Start backend: `npm --prefix backend run dev`
  - Fetch endpoint: `curl http://localhost:4000/api/feeds/acp/products.json`
  - If flat export is added: `curl http://localhost:4000/api/feeds/openai/products.jsonl`

