# Claude Task Brief

## Request
- Complete the September 17, 2026 weekly review of the live `ImagineThisPrinted1` Etsy shop.
- Compare with the September 10 review, capture four fresh screenshots, and email the illustrated report from Mr. Imagine to the WeCare team inbox.

## Repo detection
- Vite + React + TypeScript storefront with a Node/Express backend and Supabase-backed shared inbox.
- This request is an external storefront audit and email-delivery run; no Etsy settings or repo implementation code are in scope.

## Relevant files
- `AGENTS.md`
- `CLAUDE_TASK.md`
- `TASK_NOTES.md`
- `backend/routes/email.ts`
- `backend/services/email-resend.ts`

## Files to edit (STRICT)
- `CLAUDE_TASK.md`
- `TASK_NOTES.md`
- Do not modify application code, Etsy listings, prices, inventory, or policies.

## Plan
1. Inspect the live shop home, strongest featured listing, an inconsistent listing, and About/policies; retain fresh screenshots outside the repo.
2. Compare listing count, assortment, pricing, presentation, options, fulfillment details, trust copy, and visible accessibility risks with September 10.
3. Send the concise report from `mrimagine@imaginethisprinted.com` to `wecare@imaginethisprinted.com` with all four screenshots embedded by CID and attached as true PNG files.
4. Verify a delivered Resend message with four attachments, the outbound record in Mr. Imagine's Sent folder, and four working PNG downloads in the WeCare recipient record.

## Acceptance criteria
- [x] Four fresh screenshots were captured, converted to true PNG encoding, and visually inspected.
- [x] The comparison covers every requested storefront dimension and prioritizes three next actions.
- [x] The corrected true-PNG report was delivered and logged in Mr. Imagine's Sent folder with four attachments.
- [x] Resend reports four inline CID attachments and the WeCare recipient record has four downloadable, PNG-signature-verified image attachments.
- [x] No Etsy settings, listings, or repo implementation files were changed.

## Commands
- `rg -n "weekly Etsy|September 10, 2026|email_messages|mrimagine" CLAUDE_TASK.md TASK_NOTES.md backend`
- `git diff --check -- CLAUDE_TASK.md TASK_NOTES.md`
- `git diff --name-only -- CLAUDE_TASK.md TASK_NOTES.md`
- `git status --short`
