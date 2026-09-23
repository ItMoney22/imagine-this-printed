# Claude Task Brief

## Request
- Watchtower 9ff3919c-9e3f-434a-8d51-de7ee2e1f555: verify the live Etsy draft count before auditing the former 55-draft batch.
- The old batch was deleted on 2026-09-08. On 2026-09-23, Etsy API returned **6 current drafts and 14 active listings** for ImagineThisPrinted1 (shop 67055923). The six drafts were created later and are a separate cohort.

## Repo detection
- Vite/React/TypeScript storefront with Node backend and Etsy Open API integration.
- Read-only Etsy API audit; no application implementation or Etsy mutation authorized in this request.

## Relevant files
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\jessica-steele\step-1-7-audit-55-etsy-d-9ff3919c-mue0jumg\AGENTS.md`
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\jessica-steele\step-1-7-audit-55-etsy-d-9ff3919c-mue0jumg\CLAUDE.md`
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\jessica-steele\step-1-7-audit-55-etsy-d-9ff3919c-mue0jumg\backend\scripts\etsy-poc.mjs` (OAuth token and shop identity reference)
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\jessica-steele\step-1-7-audit-55-etsy-d-9ff3919c-mue0jumg\TASK_NOTES.md`

## Files to edit (STRICT)
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\jessica-steele\step-1-7-audit-55-etsy-d-9ff3919c-mue0jumg\CLAUDE_TASK.md`
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\jessica-steele\step-1-7-audit-55-etsy-d-9ff3919c-mue0jumg\TASK_NOTES.md`
- No other repo files, listing copy, Etsy state, prices, or images may be changed under this brief.

## Plan
1. Preserve the Etsy API count and six-listing punch list in the Watchtower handoff for this task.
2. Give David the labeled six-draft primary-image contact sheet at `E:\memory\watchtower\artifacts\etsy-current-six-primary-images-2026-09-23.png`.
3. Note that the obsolete 55-draft follow-on chain is already archived; keep the six current drafts separate.
4. File a scoped follow-up for the six current drafts. Four have unsupported or contradictory copy; one has no primary image. Keep all edits and publishing blocked pending David's approval.

## Acceptance criteria
- [x] Live Etsy API identifies ImagineThisPrinted1 and returns draft=6, active=14.
- [x] All six current drafts have title/description/tag capability checks; method and substrate are considered together.
- [x] A labeled image sheet exists, including a missing-image cell for listing 4580221283.
- [x] No Etsy listing was changed or published.
- [x] Former 55-draft follow-on tasks eaf5d6ed, d17ec548, and 99706f4c were verified archived.

## Commands
- `node backend/scripts/etsy-poc.mjs whoami` (from the repo's documented PoC; refreshes the saved Etsy token if expired).
- `git diff --check -- CLAUDE_TASK.md TASK_NOTES.md`
- `git status --short`
