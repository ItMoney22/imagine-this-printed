# Claude Task Brief

## Request
- Complete the September 3, 2026 weekly review of the live `ImagineThisPrinted1` Etsy shop.
- Compare the storefront with the August 20 review, capture four fresh screenshots, and email the illustrated report from Mr. Imagine to the WeCare team inbox.

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
1. Inspect the live shop home, Y2K Vibe listing, HIM WAS BAD listing, and About/policies area; retain fresh screenshots outside the repo.
2. Compare the visible shop metrics, assortment, pricing, listing presentation, fulfillment details, trust copy, and accessibility risks with the August 20 baseline.
3. Send the concise report from `mrimagine@imaginethisprinted.com` to `wecare@imaginethisprinted.com` with all four PNGs embedded by CID and attached.
4. Verify the sending service reports four attachments, the canonical outbound message is logged in Mr. Imagine's Sent folder, and the recipient record exposes four working PNG downloads.

## Acceptance criteria
- [x] Four fresh screenshots were captured and visually inspected.
- [x] The comparison covers all requested storefront dimensions and prioritizes three next actions.
- [x] The canonical email is logged in Mr. Imagine's Sent folder with four attachments.
- [x] Resend reports four inline CID attachments and the WeCare recipient record has four downloadable PNG attachments.
- [x] No Etsy settings, prices, listings, or repo implementation files were changed.

## Commands
- `rg -n "email_messages|RESEND_API_KEY|mrimagine|Weekly Etsy Shop Review" TASK_NOTES.md CLAUDE_TASK.md backend`
- `git diff --name-only -- CLAUDE_TASK.md TASK_NOTES.md`
- `git status --short`
