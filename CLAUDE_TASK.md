# Claude Task Brief

## Request
- Run the 2026-08-20 weekly review of `https://imaginethisprinted1.etsy.com`.
- Capture fresh screenshots of the shop home, strongest featured listing, weaker listing, and About/policies.
- Compare the shop with the 2026-08-13 review and prioritize the next three actions.
- Email the illustrated report from `mrimagine@imaginethisprinted.com` to `wecare@imaginethisprinted.com`, with all four PNGs embedded by CID and available as attachments.
- Do not edit Etsy or repo implementation code.

## Repo detection
- Vite + React frontend with an Express/TypeScript backend.
- The in-app email system stores mailboxes/messages in Supabase and delivers mail through Resend.
- Resend supports CID inline images backed by image attachments.

## Relevant files
- `AGENTS.md`
- `CLAUDE_TASK.md`
- `TASK_NOTES.md`
- `backend/routes/email.ts`
- `backend/services/email-resend.ts`
- `supabase/migrations/20260612000001_email_system.sql`

## Files to edit (STRICT)
- `CLAUDE_TASK.md`
- `TASK_NOTES.md`
- Do not edit any repo implementation file.
- External state in scope: one weekly report email from the existing Mr. Imagine mailbox.

## Review findings
- No meaningful storefront change from 2026-08-13: 7 active listings, 0 sales, 0 reviews, and 0 admirers.
- All seven listings remain $17.50 from $25 (30% off), and the same four products remain featured.
- `Y2K Vibe` remains the strongest listing: clear title, six images, White/Black colors, S-3XL sizing, $5 shipping, and 30-day returns.
- `HIM WAS BAD` remains the weaker listing: four images, weak thumbnail-scale text, no color choice, and no visible size chart.
- Real finished-product photography and readable size charts are still not verifiable across the shop.
- Delivery estimates shifted naturally to August 22-September 1; shipping cost, origin, and return terms are unchanged.
- The Georgia/no-dropshipping About story remains useful, but the announcement's “drawn up in-house” wording still conflicts with clearer AI-assisted disclosures.
- The storefront still needs a banner, a simpler small-size icon, and product sections; small graphic text remains a visible readability/accessibility risk.

## Plan
1. Add one real finished-shirt photo and one readable size chart to all seven listings, starting with `HIM WAS BAD` and the newer Neon City listing.
2. Standardize every listing to 6-8 purposeful images, improve thumbnail legibility, and test Neon City in the featured row only after its gallery meets the strongest listing's standard.
3. Add a banner and shop sections, simplify the icon, and align the announcement's AI wording with the About and listing disclosures.

## Acceptance criteria
- [x] Four fresh screenshots captured and visually inspected.
- [x] Current shop compared with the 2026-08-13 baseline.
- [x] Concise report sent from Mr. Imagine to `wecare@imaginethisprinted.com`.
- [x] Four CID image attachments verified in Resend.
- [x] Four image attachments verified in the `wecare` recipient record.
- [x] All four recipient attachment URLs downloaded successfully as PNG files.
- [x] Outbound report logged in Mr. Imagine's Sent folder with four attachments.
- [x] No Etsy or repo implementation changes made.

## Commands
- Read-only review used the live Etsy storefront in the browser.
- Mail verification used the existing Resend API and Supabase email records.
- No repo build or test command is required because no implementation code changed.
