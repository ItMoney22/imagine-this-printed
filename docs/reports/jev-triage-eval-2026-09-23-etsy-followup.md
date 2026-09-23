# Jev Etsy buyer-note triage — real-data follow-up (2026-09-23, Watchtower 7f91312c)

Follow-up to `jev-triage-eval-2026-09-23.md` (task 2a83afec, commit b278fe8). That
report's Etsy section was scored on 12 synthetic notes because production had zero
Etsy orders with a buyer note. This task's job was to re-run it against real notes
once receipt ingest flows.

## Finding: production still has zero real Etsy orders — not just zero with a note

Checked directly against prod (`orders` table, service role): **0 rows with
`source='etsy'`**, so there is nothing to hand-label yet. Root cause confirmed at
the source — `etsy_connection.scopes` is `listings_r listings_w shops_r shops_w`
(no `transactions_r`), and `etsy_connection.receipts_watermark` is still `0`,
meaning `pollReceipts()` has never advanced past its starting point. This is the
same blocker tracked on the board as task **c93b557e** ("DAVID ACTION: Sign in to
Etsy OAuth to grant transactions_r scope"), still open as of this run. No new
approval was filed for this — it would be a duplicate of c93b557e.

## What this task did instead

Since deliverables 1–2 (pull + hand-label real notes) have nothing to pull, the
judgment call (per the task's own open question) was: don't fabricate "real" data,
and don't skip the tuning work either. Two things:

1. **Pressure-tested the existing floor keywords** with a harder, hand-built,
   entirely-synthetic 30-row set (`ETSY_SYNTHETIC_FALLBACK` in
   `backend/scripts/jev-triage-eval.ts`) — 8 none / 8 personalization / 7
   change_request / 7 problem, including adversarial cases the original 12 didn't
   cover (negated urgency, colon-glued labels, floor-silent rows that only pass if
   Jev's raw read is right). It's safe to commit because none of it is real
   customer text, unlike the real dataset (which stays outside the repo, per the
   original report's own stated practice).
2. **Found and fixed two real regex bugs** in `backend/lib/jev-triage.ts`'s
   `etsyFlagFloor()`:
   - `RE_ETSY_PROBLEM`'s bare `urgent|asap` fired even when negated — `"Not
     urgent, just wanted to say I loved my last order!"` floored to `problem`.
     Because the floor is a MINIMUM Jev can raise but never lower, this was a
     **silent** false positive (Jev's correct `none` answer gets overridden, and
     `needsReview` stays `false` because Jev *was* confident — just about a
     lower-ranked answer). Fixed with a negation guard (`not/no/nothing/isn't/
     wasn't/never` within 2 words of `urgent`/`asap`).
   - `RE_ETSY_PERSONAL` required a literal space before the colon in `"Name: X"` /
     `"Number: X"`, so the very common no-space format (`"Name:Ava"`,
     `"Names:Ava and Ben"`, `"Number:7"`) fell through to no floor opinion at all.
     Fixed to accept `name(s)?\s*:` and `number\s*:?\s*\d+`.
   Both are covered by new unit tests in `backend/lib/jev-triage.test.ts`
   ("negated urgency", "colon-attached label").

## Eval results (synthetic fallback, live Jev call — `typesafe/jev-1.13`)

30 rows, run via `npx tsx --env-file=.env scripts/jev-triage-eval.ts <empty-dataset.json>`
(empty `etsy: []` triggers the fallback):

| | floor only | Jev raw | Jev + floor (final) |
|---|---|---|---|
| accuracy | 83.3% (25/30) | 100% (30/30) | **100% (30/30)** |

Per-class precision / recall (final, all support 7–8 rows/class):

| class | precision | recall |
|---|---|---|
| none | 1.00 | 1.00 |
| personalization | 1.00 | 1.00 |
| change_request | 1.00 | 1.00 |
| problem | 1.00 | 1.00 |

Problems silently missed (wrong flag AND not sent to review): 0/7. 2 rows sent to
human review despite landing on the right flag (expected — Jev under the 0.80
confidence bar on a couple of the harder rows). Run cost: **$0.00065**.

**Caveat, stated plainly:** this is 30 rows I wrote myself, several of them
designed specifically to hit the two bugs I'd just found and fixed — a 100% score
here is a real regression check, not proof the shipped wording generalizes to
what actual Etsy buyers write. It does not replace real-data evaluation. Re-run
this script with a real `data.etsy[]` the moment c93b557e clears (the real
dataset will automatically take priority over the synthetic fallback — no code
change needed).

## What was NOT tuned

`ETSY_FLAG_CRITERIA` (the Jev question wording) was left unchanged — raw Jev
accuracy was already 100% on this set, so there was no signal to act on. If real
notes later show a different failure pattern, that's the first place to look.

## Regression check

`npx vitest run` (full backend suite): 1521 passed, 3 failed — all 3 in
`services/etsy-copy-repair.test.ts`, pre-existing and unrelated (already known and
fixed on unmerged commit `6a32a2a`, per commit b278fe8's own message). Nothing in
`jev-triage.test.ts` (28/28) or `etsy-receipt-ingest.test.ts` (7/7) regressed.
`tsc --noEmit`: clean except pre-existing, unrelated `@types/qs` portability
errors in `middleware/rate-limits.ts`.
