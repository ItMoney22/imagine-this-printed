# Merge batch e14d239c — the 15 finished 9/22-9/30 branches, ship-ready

Branch `earth/ada-brooks/itp-review-merge-15-fini-e14d239c-mv5h4d1c` = live main **a28c1b1** + the batch below.
origin/main is an ancestor, so it fast-forwards today. Only zero-nine ships ITP; this rides Nine's ship AFTER the
10/13 superset (card 4646cb1f), never alongside it.

## Per row

| Row | What | Branch tip | Result |
|---|---|---|---|
| bef81073 | backend asks Sifu for its OpenAI key (inert until SIFU_APP_TOKEN) | 5c5cd21 | merged (clean) |
| 4ddd435a | RLS reconciliation + email_logs authenticated INSERT drop | fb4de67 (+6242274) | merged; both migrations already live on prod since 9/22 |
| 9efccea0 | ITC refund guard — closes the live /api/wallet/refund-itc self-mint | 0ea5025 | merged; migration renamed 20260922120000 -> **20261013120000** (version taken on prod by signup_wallet_and_welcome_email). NOT on prod yet: apply after deploy |
| 65017d78 | atomic ITC purchase claim in the Stripe webhook | 6449f31 | merged; claim_itc_purchase already live (service_role only) |
| 2cabfb06 | maker attribution into Stripe metadata | 248f410 | merged; kept main's printFileRefs in storefront.ts; products.maker_agent_id already live |
| 4af85ead | runaway Mrs. Imagine generator guard | d6ae955 | merged |
| eb06cd30 | Mrs. Imagine capability boundary (b. 4ebf57e) | 4ebf57e | merged; kept both the guard and the metal-art hold in startMrsImagineBatch |
| 22bacf35 | garment colour measured from the artwork (b. b125d8b) | b125d8b | merged; SCORE_WEIGHTS = garment branch's 100-point split + capability weight 0 |
| 9676701d + 6b03f251 | Jev IP gate + Jev copy QA + Joshua's blank-copy fix | 2e4f5d3 (carries d1582dc, db48b2d, 3b67791) | merged; ONE backend/services/jev.ts now serves Step Flow casting and copy QA; capability blocks count toward "already blocking" before the vision call. Ethan's scout commit f8122ea (CLAUDE_TASK.md only) left out |
| 04115d9b | Jev triage priority wording + internal-sender floor | 8e4de72 | cherry-picked without its CLAUDE_TASK.md brief |
| 6f448b96 | on-person back shot + paired spin video | 551b64d | merged; gallery keeps both back roles |
| 6e79481e | CRM money in SQL + paged admin lists | d317fff | merged; main's 10/7 one-menu admin layout kept (its vendor/model tabs and Quick Actions stay retired); migration renamed -> **20261013120100** (functions already live, byte-identical, ledger row missing) |
| 993c422f | printed garments priced off real blank cost (b. 803c8bb), David's option A on 91b0e9f2 | 803c8bb | merged; Margins panel lives under Pricing > Garment margins (no new menu); sizePriceDelta, cart and product page skip the flat +$2.50 / tier ladder on a variant-priced, non-bundle line |
| 05d90a09 | Amelia's team-template rebuild | b88678a | **held**: superseded 9/24 by Team Studio (Nine: do not merge) |
| 6bec6d3b | Fly deploy workflow (b. 554b32a) | 554b32a | **held**: the fleet gh token lacks the `workflow` scope, so a push carrying .github/workflows is refused; Render is still prod and the Fly cutover (4e42e490) has not happened |

## Gates (on the branch)
- `npm run verify`: tsc -b clean, vitest **178 files / 2,626 tests pass**.
- backend `tsc --noEmit`: only the 6 known TS2742 (worktree node_modules path).
- `vite build` OK.
- Trial merge of this batch + the whole 10/13 superset (35cc532b, 8b0676b, 051355f, d50f833): verify **182 files / 2,691 pass**,
  backend tsc clean. Conflicts there: TASK_NOTES.md (union), docs/BLANK_COST_SYNC.md (take Vinny's, a superset),
  backend/services/order-pricing.test.ts (keep both describe blocks; close the variant block with `  })\n})` before the referral block).

## Database
- `prove-migrations-rolled-back.txt`: both migrations applied inside one live transaction and rolled back. refund_itc_for_debit
  is service_role only, returns debit_not_found / invalid_amount as designed; crm_* service_role only.
- `apply-after-deploy-dry-run.txt`: the after-deploy script, dry run, rolled back. `--apply` refuses until abe10ca is on origin/main.
- `admin-paged-queries-live.txt`: the CRM branch's server-side product filters return exactly what the old browser filter did
  (236 / 168 / 12 / 23 rows).
- No refund row has ever been written (no sign the self-mint hole was used); 6 wallets.

## Walk (local vite on the branch, live Supabase data)
`pp-desktop-1400.png`, `pp-phone-390.png`: Man I Love Frogs, 3XL + Black + Heavyweight Garment-Dyed = **$38.65**
(live code charges $25 + $2.50 + $7 = $34.50); each size button shows its real price; youth $22.27 (table $25.27 - $3).
`cart-desktop-1400.png`, `cart-phone-390.png`: line $38.65 = subtotal $38.65; 2 units $77.30.
Not walked: admin Pricing > Garment margins (needs an admin session) — walk it after deploy.
