# Claude Task Brief

## Request
- Complete the October 29, 2026 weekly review of the live `ImagineThisPrinted1` Etsy shop.
- Compare it with the October 22 review, capture four fresh screenshots, and email the illustrated report from Mr. Imagine to the WeCare team inbox.

## Repo detection
- Vite + React + TypeScript storefront with a Node/Express backend and a Supabase-backed shared inbox.
- This request is an external storefront audit and email-delivery run; no Etsy settings or repo implementation code are in scope.

## Relevant files
- `AGENTS.md`
- `CLAUDE_TASK.md`
- `TASK_NOTES.md`
- `package.json`
- `backend/routes/email.ts`
- `backend/services/email-resend.ts`
- `supabase/migrations/20260612000001_email_system.sql`

## Files to edit (STRICT)
- `CLAUDE_TASK.md`
- `TASK_NOTES.md`
- Do not modify application code, Etsy listings, prices, inventory, or policies.

## Plan
1. Inspect the live shop home, strongest featured listing, an inconsistent listing, and About/policies; retain fresh screenshots outside the repo.
2. Compare listing count, social proof, assortment, sale pricing, titles, imagery, options, fulfillment details, trust copy, and visible accessibility risks with October 22.
3. Send the concise report from `mrimagine@imaginethisprinted.com` to `wecare@imaginethisprinted.com` with all four screenshots embedded by CID and attached as true PNG files.
4. Verify delivery, four Resend attachments, the outbound record in Mr. Imagine's Sent folder, and four working PNG downloads in the WeCare recipient record.

## Acceptance criteria
- [x] Four fresh screenshots were captured as true PNG files and visually inspected.
- [x] The comparison covers every requested storefront dimension and prioritizes three next actions.
- [x] The illustrated report was delivered and logged in Mr. Imagine's Sent folder with four attachments.
- [x] Resend reports four received attachments, and the WeCare recipient record contains four downloadable, PNG-signature-verified images.
- [x] No Etsy settings, listings, or repo implementation files were changed.

## Commands
- `rg -n -i "2026-10-22|weekly etsy|mr\\. imagine|wecare" CLAUDE_TASK.md TASK_NOTES.md AGENTS.md`
- `git diff --check -- CLAUDE_TASK.md TASK_NOTES.md`
- `git diff --name-only -- CLAUDE_TASK.md TASK_NOTES.md`
- `git status --short`
