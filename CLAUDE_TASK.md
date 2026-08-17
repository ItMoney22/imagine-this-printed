# Claude Task Brief

## Request

Complete Watchtower task `1f3d9e7d-3def-47f6-8fc7-1b08907d3555`: upload the remaining layered PSD originals for the design library to GCS, then prove the run completed and is safely resumable.

## Repo detection

- React/Vite repository with an Express backend; Node is `>=18.17`.
- The media-import implementation was merged in commit `6758993`, but this dispatch checkout no longer contains its script.
- A preserved, non-shared importer worktree exists at `C:\Users\David\.watchtower-dispatch-worktrees\imagine-this-printed\iahhm\fix-design-library-url-e-1cb2f16c-ms2csjjm`; it contains the canonical script and `backend/.env`.

## Relevant files

- `AGENTS.md`
- `CLAUDE.md`
- `backend/scripts/backfill-design-library-media.mjs` (commit `6758993` / preserved importer worktree)
- `backend/scripts/lib/design-media.mjs` (commit `6758993` / preserved importer worktree)
- `backend/.env` in that preserved worktree (credentials only; never print or commit)
- `E:\memory\watchtower\handoffs\handoff-iahhm-1786897665278.json`

## Files to edit (STRICT)

- `CLAUDE_TASK.md`
- `TASK_NOTES.md`
- `backend/scripts/backfill-design-library-media.mjs` only if required to correct the PSD eligibility/checkpoint logic below.
- Do not change product/UI code, production configuration, or existing source metadata manually.

## Observed blocker

The canonical script regards a product as source-complete whenever `metadata.source_files` is nonempty. The completed vector/JPG pass populated that object without a `psd` key, so `--sources --include-psd` currently skips every eligible product before it reaches `uploadSources()`. Correct the predicate so an include-PSD run is eligible when `metadata.source_files.psd` is absent (while retaining the existing empty/local-path cases). Add concise run-summary evidence for same-size GCS objects skipped, if it is not already emitted. Keep the changes idempotent and limited to the backfill script.

## Plan

1. Work only in the preserved importer worktree; confirm its script matches commit `6758993`, its `.env` has GCS/Supabase values, and the design root is accessible.
2. Patch the PSD eligibility/checkpoint condition and verify a small `--dry-run --sources --include-psd --limit 20` selects products that lack PSD metadata without writing remote state.
3. Run the required production command in a durable foreground session: `cd backend && node scripts/backfill-design-library-media.mjs --sources --include-psd`. Preserve output to an external operational log, not the repository.
4. Monitor progress at least every few minutes. If interrupted, rerun the same command; same-size objects must be skipped and already-recorded PSD metadata must remain untouched.
5. Verify GCS under `gs://imagine-this-printed-main/design-sources/<collection-slug>/<design-id>.psd`: record PSD object count and total bytes, expect roughly 11 GB, and compare the sampled object sizes with `metadata.source_files.psd.bytes`.
6. Re-run the command once after completion (or a bounded no-write verification mode) and capture idempotency evidence: zero new uploads/row updates and same-size-object skips. Also run `node scripts/backfill-design-library-media.mjs --verify 20`.

## Acceptance criteria

- [ ] The exact PSD command has run to completion (and was safely resumed if needed).
- [ ] Every eligible PSD has a reachable `metadata.source_files.psd` record and matching GCS object.
- [ ] GCS contains the PSD tier at `design-sources/**.psd`, totaling approximately 11 GB.
- [ ] Logs explicitly show same-byte-size GCS objects skipped on a rerun.
- [ ] The permanent-media verification passes with no fatal/update/source failures.

## Commands

```powershell
$wt = 'C:\Users\David\.watchtower-dispatch-worktrees\imagine-this-printed\iahhm\fix-design-library-url-e-1cb2f16c-ms2csjjm'
Set-Location "$wt\backend"
node scripts/backfill-design-library-media.mjs --dry-run --sources --include-psd --limit 20
node scripts/backfill-design-library-media.mjs --sources --include-psd
node scripts/backfill-design-library-media.mjs --verify 20
```

Use the GCS client authenticated by `backend/.env` for count/byte verification; do not expose credentials.
