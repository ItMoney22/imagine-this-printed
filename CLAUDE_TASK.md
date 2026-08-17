# Claude Task Brief

## Request (Watchtower task e7679a5a-440c-4a6e-aea8-36aede8cf9d7, continuation of 1f3d9e7d)
- Fix the `--include-psd` eligibility checkpoint in `backend/scripts/backfill-design-library-media.mjs`.
- Run the monitored PSD upload to `gs://imagine-this-printed-main/design-sources/`.
- Verify uploaded-asset count and total bytes against the ~11 GB / ~2,700-design expectation.

## Repo detection
- Vite + React frontend with an Express/TypeScript backend.
- `backend/scripts/backfill-design-library-media.mjs` + `backend/scripts/lib/design-media.mjs` repair
  design-library product rows (permanent media URLs, pixel dims, and original source files uploaded to GCS).
- Preserved importer worktree with a working `backend/.env`:
  `C:\Users\David\.watchtower-dispatch-worktrees\imagine-this-printed\iahhm\fix-design-library-url-e-1cb2f16c-ms2csjjm`

## Root cause (found)
`repair()`'s source-files checkpoint was:
```js
const needsSources = !meta.source_files || Object.keys(meta.source_files).length === 0 ||
  sourceFilesAreLocalPaths(meta.source_files)
```
A prior `--sources` run (vectors+jpg only, no `--include-psd`) leaves `metadata.source_files` nonempty
(e.g. `{ai:{...}, jpg:{...}}`). That satisfies all three conditions above, so a later
`--sources --include-psd` run sees every product as already "done" and never re-scans for `.psd` files —
PSDs are silently never uploaded, matching Mia Potts's scout finding in
`E:\memory\watchtower\handoffs\handoff-mia-potts-1786930581931.json`.

## Files to edit
- `backend/scripts/backfill-design-library-media.mjs` (checkpoint fix — done)
- `TASK_NOTES.md` (work-log bullet)
- `CLAUDE_TASK.md` (this file)
- No other implementation files in scope.

## Fix applied
Added a `meta.source_files_psd_checked` marker set whenever a PSD-inclusive scan runs for a product
(regardless of whether a `.psd` was actually found on disk, so a design with no PSD converges after one
pass instead of being rescanned every run). `needsSources` now also re-triggers when
`INCLUDE_PSD && !meta.source_files_psd_checked`. `uploadSources()` itself was already correctly
resumable (skips re-upload when the GCS object exists at the same byte size), so this fix only had to
correct the per-product eligibility gate, not the upload logic.

## Commands
```
cd backend
node scripts/backfill-design-library-media.mjs --dry-run --sources --include-psd --limit 20
node scripts/backfill-design-library-media.mjs --sources --include-psd
node scripts/backfill-design-library-media.mjs --verify 20
```
Run from a worktree with `backend/.env` + `backend/node_modules` present (this dispatch worktree, once
`npm install` completes) or the preserved iahhm worktree above.

## Acceptance criteria
- [x] Checkpoint no longer treats vector/jpg-only `source_files` as PSD-complete.
- [ ] Monitored upload run completed against the design library.
- [ ] GCS object count + total bytes in `design-sources/` reported and reconciled against expectation (~11 GB).
