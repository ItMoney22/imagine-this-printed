# Claude Task Brief

## Request
- Correct the 2026-08-06 weekly Etsy report because the original email omitted its screenshots.
- Send the four audit screenshots from `mrimagine@imaginethisprinted.com` to `wecare@imaginethisprinted.com`.
- Update the weekly heartbeat so every future report includes and verifies its images.
- Do not edit Etsy or repo implementation code.

## Repo detection
- Vite + React frontend with an Express/TypeScript backend.
- The in-app email system stores mailboxes/messages in Supabase and delivers mail through Resend.
- Resend supports CID inline images backed by normal image attachments.

## Relevant files
- `AGENTS.md`
- `CLAUDE_TASK.md`
- `TASK_NOTES.md`
- `backend/services/email-resend.ts`
- `backend/routes/email.ts`
- `C:/Users/David/.codex/automations/weekly-etsy-shop-review/automation.toml`

## Files to edit (STRICT)
- `CLAUDE_TASK.md`
- `TASK_NOTES.md`
- Do not edit any repo implementation file.
- External state in scope: one corrected report email and an update to the existing heartbeat.

## Completed correction
- Sent subject: `Corrected: Mr. Imagine's Weekly Etsy Shop Review - August 6, 2026 (Screenshots Included)`.
- Included all four fresh PNG screenshots inline beside their matching report sections.
- Included the same four PNGs as attachments for clients that block inline images.
- Resend reported four inline attachments with distinct content IDs.
- The `wecare` recipient record received all four images with stored download URLs.
- The corrected outbound message is logged in Mr. Imagine's Sent folder.

## Future weekly-report requirements
1. Capture four fresh screenshots: shop home, strongest listing, weaker listing, and About/policies.
2. Insert each screenshot beside its matching email section using a CID reference.
3. Attach the same four PNG files to the email.
4. Verify four attachments in the sending-service record.
5. Verify four working image attachments in the `wecare` recipient record.
6. Do not claim completion if any image or verification is missing.

## Acceptance criteria
- [x] Corrected report sent from Mr. Imagine.
- [x] Four screenshots embedded inline.
- [x] Four PNG attachments included.
- [x] Sending-service attachment count verified.
- [x] Recipient attachment count and stored links verified.
- [x] Weekly heartbeat updated with mandatory image checks.
- [x] No Etsy or repo implementation changes made.

## Commands
- Read-only verification uses Resend attachment metadata and existing Supabase email records.
- No repo build or test command is required.
