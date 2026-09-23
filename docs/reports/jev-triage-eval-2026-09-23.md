# Jev triage eval — 2026-09-23 (Watchtower 2a83afec)

Script: `backend/scripts/jev-triage-eval.ts <dataset.json>`. The dataset holds real
customer and supplier mail, so it lives outside the repo (Lucas Blaze's scratchpad for
this run). Every row was hand-labelled before the run. There were 3 runs: run 1 measured the first
wording, and runs 2 and 3 measured the shipped wording. Jev varies a little from run to
run, so this report gives both. Model `typesafe/jev-1.13`; each
run cost about **$0.008**.

"Old" means what production did before this change:
- **Tickets:** the category the customer picked, and priority `billing ? high : medium`.
- **Mail:** summarize every email.
- **Etsy:** no flag at all.

## Support tickets — 77 rows

67 real rows: the 66 tickets in the 2026-08-07 purge backup plus 1 live ticket. The
other 10 are synthetic, one or two per class that production has never seen.

| | old | floor only | Jev + floor (shipped) |
|---|---|---|---|
| category right | 5.2% | 14.3% | **100%** |
| priority right | 5.2% | 7.8% | **94.8%** |

- **Misses:** 4 priority misses on both runs:
  - 3 real sign-in tickets that are labelled high came back normal. Each was sent to human review.
  - One synthetic bulk quote labelled urgent came back high. On run 2 it went to review; on
    run 3 Jev was confident, so it went straight to high. It stayed at the top of the queue
    either way.
- **Bulk and damaged tickets:** none of the 4 landed below high.

## Shared mailbox — 141 rows

135 real inbound external emails and 6 synthetic ones (leads, customer issues and
supplier questions — the live inbox has none).

| | floor only | Jev raw | Jev + floor (shipped) |
|---|---|---|---|
| label right (run 2 / run 3) | 61.7% | 61.7% | **91.5% / 92.2%** |
| confident Jev labels right | — | — | **42/42 / 43/44** |
| needs_reply exact | — | 94.3% | 91.5% / 90.1% |

On run 3, one confident label was wrong: a supplier promo was labelled `etsy_notification`
at exactly the 0.75 bar. Its reply status was correctly `no`, so the mistake is harmless.

- **Gemini digest:** before this change it summarized all 141 emails. Now it summarizes
  **15–17**, and all **14 of 14** emails that truly need a reply are kept on both runs.
- **Human review:** 18–19 rows. They are unsure, so they stay in the summary and are never hidden.

The first run labelled supplier promo blasts as `supplier` with low confidence (a 60%
label rate). The option wording now says a supplier's marketing blasts are `newsletter`.
That fix was measured on the second run.

## Etsy buyer notes — 12 synthetic rows

Production has no Etsy order with a buyer note yet: receipt ingest is waiting on the
`transactions_r` scope (task c93b557e).

- **Floor only:** 75%. **Jev + floor:** 100% after narrowing the "problem" keyword floor.
  Before narrowing it was 91.7%, because the word "mistake" forced a change request up to `problem`.
- **Problems silently missed:** 0 of 3.
- **Before real data exists:** re-run this against real notes once receipts flow.

## Why the default is `JEV_TRIAGE=on`

- **Tickets:** Jev beats the old method by 90+ points on category, and every
  low-confidence miss goes to human review.
- **Mailbox:** 85 of 86 confident labels were right across runs 2 and 3, and no email that
  needed a reply was ever left out of the summary.
- **Rollback:** set `JEV_TRIAGE=shadow` (record Jev, the floor decides) or
  `JEV_TRIAGE=off`. This is an env flip with no deploy of code.
