# Jev product-kind: ship check, 2026-10-12 (task 332c46f6, Zero Nine)

Follows `jev-product-kind-dryrun-2026-10-12.md` (Dr. Dill, task 28ab467c). This covers the ship card: land 8887982
on ITP main, confirm the shadow deploy, then turn on `PRODUCT_KIND_JEV=on` for both Render services.

## Where it stands

**Not shipped today. It rides the 10/13 daily ITP ship (card 4646cb1f).** ITP had its one daily ship at 15:30Z
(7314e53, not a hotfix), followed by three hotfixes. The ship tool (`engine/production-ship.ts` shipRefusal) refuses a
second non-hotfix ship on the same Earth day. This change fixes copy and categories on drafts and rejected rows. It is
not an outage on the live store, so calling it a hotfix to get around the daily limit would be dishonest. The flag
flip waits for the deploy, because the live code (a28c1b1) ignores `PRODUCT_KIND_JEV`. Turning it on now would skip
the shadow stage when 10/13 deploys.

## Gates on 8887982 (= origin/main a28c1b1 + 1 commit; fast-forward)

| gate | result |
|---|---|
| `npm run verify` (tsc -b --noEmit + vitest) | exit 0, 170 files / 2,429 tests |
| `npx vite build` | exit 0 (built in 11.4 s) |
| backend `npx tsc --noEmit` | only the 6 known TS2742 (`middleware/rate-limits.ts`, junctioned node_modules), nothing new |

## 10/13 batch probe: 4646cb1f's branches + 8887982

Combined in a detached scratch worktree: 8887982 + 35cc532b + 8b0676b + 051355f + d50f833 + eac8f19.

- merge-tree for 8887982 against each one: the code is clean every time. Only `TASK_NOTES.md` conflicts (append-only notes,
  union keeps both sides) against 35cc532b, 8b0676b, d50f833 and eac8f19. 051355f is clean.
- vitest on the combined tree: **179 files / 2,550 tests pass**. The first run had 7 suites fail at load because the
  scratch tree had no `.env.local` (Supabase URL). After linking it, everything passed.
- tsc -b on the combined tree: clean. backend tsc shows 7 TS2742: the known 6, plus `designEventsLimiter` from eac8f19,
  which is the same junction class.

## Dry run, re-run today on the merged code against the live catalogue

`cd backend && npx tsx --env-file=<shared backend/.env> scripts/jev-product-kind-dryrun.ts --out <scratch>`. This is
read-only. The OpenRouter key is the PRINTED key (fingerprint 6034e727f510, same as both Render services).

| | Dr. Dill (morning) | Nine (this run) |
|---|---|---|
| rows / answered | 2,605 / 2,605 | 2,605 / 2,605 |
| cost | $0.0998 | $0.0998 (2,377,010 input tokens, 105 s) |
| shadow: rows whose behaviour changes | 0 | 0 |
| on-mode reviews at 0.85 | 29 | **28** |
| real misroutes / false alarms | 21 / 8 | **21 / 7** |
| by status | rejected 16, draft 13 | draft 12, rejected 8, archived 8 |

The one row that dropped out is `19ba795a` "Best Mom Ever Badge", one of Dr. Dill's 8 false alarms. Jev scored it as
"other" at 0.86 this morning and 0.83 now, which is under the bar. The other 28 rows match his exactly. 8 of his rejected
rows have since been archived. Per-row JSON (2.9 MB, kept out of git):
`E:/memory/watchtower/projects/imagine-this-printed/2026-10-12-332c46f6-product-kind-ship/jev-product-kind-dryrun-2026-10-12-rerun.json`.

The dry run works out the shadow and the on decisions locally, so the Render flag does not change its output. A run
after the flip only repeats this one. The live proof of the flip is the services' own log: the line
`[product-kind] shadow …` becomes `[product-kind] on …`, and new needs-review rows carry `metadata.product_kind`.

## Render today (read-only)

| service | live deploy | commit | PRODUCT_KIND_JEV | OpenRouter key |
|---|---|---|---|---|
| API srv-d7jpgut7vvec739bsid0 | dep-db6gpb15efls73dk6g10 | a28c1b1 | unset (shadow) | 6034e727f510 (PRINTED) |
| worker srv-d7jppnn7f7vs73bb4p80 | dep-db6grcd9fdbs73fgpe70 | a28c1b1 | unset (shadow) | 6034e727f510 (PRINTED) |

The OpenRouter key move (afe872a7) has already landed and the old key is deleted (e5c822de), so Jev will answer live. If
OpenRouter ever fails, the resolver falls back to the old rules (tested: no key, 503, throw, off-menu).

## After the 10/13 deploy (on card 4646cb1f)

1. Shadow is live: both services are live on a commit that contains 8887982, the flag is unset, and the logs show
   `[product-kind] shadow` lines. Flag-independent checks:
   - hoodies, transfers, 3D and youth rows compose with their own copy (`etsy-seo-composer.kind.test.ts`)
   - copy repair no longer writes tee bodies for 3D or other rows (`etsy-copy-repair.test.ts`)
   - creator approve answers 409 "pick its category" for a product nothing identifies (`user-product-approvals.kind.test.ts`)
2. `node E:/memory/watchtower/projects/imagine-this-printed/2026-10-12-332c46f6-product-kind-ship/flip-product-kind-jev.cjs --check`,
   then `--apply`. It refuses unless 8887982 is on origin/main and in both services' live commit, and both still carry
   the PRINTED key. It sets `PRODUCT_KIND_JEV=on` on both, deploys both, waits for live, and prints `RESULT: PASS`.
   `--rollback` deletes the variable, which puts both back in shadow.
3. Re-run the dry run. Expect about 28 reviews (21 real, 7 false alarms). Report the real numbers.
4. Re-filing the 21 misrouted rows is a person's call (Dr. Dill's note). The admin UI for the 409 is card e462e3a4.
