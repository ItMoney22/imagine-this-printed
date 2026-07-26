# Claude Task Brief
## Request
- Improve the live Etsy shop at `https://imaginethisprinted1.etsy.com` using the evidence-backed audit below.
- This brief is analysis and planning only. Do not change the live Etsy shop, activate drafts, spend listing fees, or edit repo implementation files until David explicitly approves execution.

## Repo detection
- JavaScript/TypeScript project with a Vite + React frontend and an Express/TypeScript backend in `backend/`.
- The repo already contains an Etsy publishing pipeline, an Etsy-native listing composer, a review queue, copyright checks, and generated model-shot support.
- `TASK_NOTES.md` records 17 Etsy drafts and a current opt-in workflow; the public shop showed only one active listing during the 2026-07-26 audit.
- Root commands from `package.json`: `npm run typecheck`, `npm run test`, `npm run build`, and `npm run lint`.
- No code or automated test command is required for this live-shop audit.

## Relevant files (Claude MUST read these first)
- `AGENTS.md`
- `CLAUDE.md`
- `CLAUDE_TASK.md`
- `TASK_NOTES.md` (focus on the 2026-07-25/26 Etsy entries)
- `backend/services/etsy-seo-composer.ts`
- `backend/services/etsy-model-shots.ts`
- `backend/services/etsy.ts`
- `src/components/AdminEtsyPanel.tsx`

## Files to edit (STRICT)
- No repo code files are approved for this audit.
- `TASK_NOTES.md` may receive one concise milestone/work-log bullet after a separately approved implementation pass.
- Live Etsy edits are not approved yet. If David approves them later, limit the first pass to shop branding/profile fields and listing `4544353578`; activating additional paid listings requires separate confirmation.

## Context from scouting
- Audit flow captured on 2026-07-26:
  1. Shop home: one active $25 listing, no reviews, no sales, no visible shop banner, and a detailed logo that becomes illegible at Etsy's small icon size.
  2. Listing top: the hero is a generated purple mascot wearing the shirt; four images are present, but the visible gallery does not establish the real finished garment, print texture, fit, or size.
  3. Listing purchase/details: no size or color selector was visible before `Add to cart`; the listing does show Georgia shipping, an arrival estimate, accepted returns, $5 shipping, care instructions, and an AI-use disclosure.
  4. About/policies: the announcement contains useful specifics (DTF, Rockmart, 1–3 business days, custom work), but the About section is one sentence, the seller card uses a letter avatar rather than a person/photo, and the policy area is sparse.
- Highest-risk issue: the shop says shirts are printed in-house, while the first listing image is an artistic rendering. Etsy's Listing Image Requirements say the first image should show the actual finished product; mockup exceptions are limited. Use a real photographed shirt as image 1 and treat generated/model mockups as secondary only after checking the applicable exception.
- The announcement says every design is "drawn up in-house," while the listing calls the design AI-assisted. Replace this with transparent language such as "directed and curated in-house" and keep the required AI disclosure in each relevant listing.
- The current title is long and keyword-stacked. Etsy's April 2026 title guidance favors clear, easy-to-scan titles because search now considers the full listing, including tags, attributes, description, first image, and reviews.
- Suggested buyer-facing title: `Simply Be You Retro Varsity T-Shirt | Unisex Graphic Tee`.
- Suggested focused shop promise: `Playful confidence tees and custom designs, printed to order in Georgia.` Keep 3D prints out of the lead promise until that category has enough active products to support it.
- Official references:
  - `https://www.etsy.com/legal/policy/listing-image-requirements/253962679005`
  - `https://www.etsy.com/legal/sellers/`
  - `https://www.etsy.com/seller-handbook/article/1399426136697`
  - `https://www.etsy.com/seller-handbook/article/358680450619`
  - `https://www.etsy.com/seller-handbook/article/22636178725`

## Plan (step-by-step)
1. Fix purchase readiness on listing `4544353578`:
   - Verify size and color variations are configured and visible.
   - Add a readable size chart and state garment brand/model, fabric composition, weight, available sizes/colors, print dimensions, and processing time.
   - Replace image 1 with a real photo of the actual finished shirt.
   - Build a 7–10 image sequence: real hero, front, back, close-up of DTF texture, model/fit reference with model size, size chart, color options, packaging/process, and an optional final brand card.
   - Add a short real-product video if available.
2. Tighten listing copy:
   - Use the concise title above or a close variant.
   - Put the shopper benefit and physical product facts in the first two description lines.
   - Move secondary phrases such as casual streetwear and gift intent into tags, attributes, and later description copy.
   - Preserve the AI disclosure and make it consistent with the shop announcement.
3. Complete the trust layer:
   - Add a simple, legible 500×500 shop icon.
   - Add a cohesive banner featuring real finished products and a short value promise.
   - Add Christina's clear owner photo and a fuller About story with workspace, printing, and packing photos/video.
   - Explain who designs, prints, quality-checks, and ships each order.
4. Build inventory depth only after the first listing passes QA:
   - Select 6–12 coherent designs from the existing draft queue.
   - Keep the initial assortment centered on one promise, such as playful/affirming graphic tees.
   - Do not activate any draft until its real-product imagery, variations, title, tags, attributes, description, shipping, return policy, and IP review are complete.
   - Feature the strongest four listings once enough inventory is live.
5. Measure before buying ads:
   - Record visits, favorites, listing clicks, add-to-carts, and conversion for 30 days.
   - Test one variable at a time, starting with the first photo and title.

## Acceptance criteria (checkboxes)
- [ ] Listing `4544353578` has visible size and color choices before `Add to cart`.
- [ ] The first listing image is a real photo of the actual finished shirt, not a mascot scene or artistic rendering.
- [ ] The listing has a coherent 7–10 image sequence plus a size chart; any generated mockup is secondary and policy-appropriate.
- [ ] The title is clear and scannable, with secondary keywords moved into tags, attributes, and description.
- [ ] The description names the garment, materials, fit, sizes, colors, print method, care, processing, shipping, returns, and AI role.
- [ ] The shop has a legible icon, banner, owner photo, fuller About story, and process imagery.
- [ ] The announcement and listing disclosures describe the design process consistently.
- [ ] At least 6 coherent listings pass the same QA checklist before activation is proposed.
- [ ] No live Etsy edit, paid activation, ad spend, or repo code change occurs without David's approval.

## Commands to run
- Manual shop check: open `https://imaginethisprinted1.etsy.com`.
- Manual listing check: open `https://www.etsy.com/listing/4544353578/retro-varsity-shirt-simply-be-you`.
- Verify desktop storefront, listing gallery, variations, `Add to cart`, About, and Shop Policies.
- No repo test/build command is required unless a later approved pass changes the Etsy integration code.
