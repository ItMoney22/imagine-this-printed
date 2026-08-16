# Claude Task Brief

## Request
- Regenerate docs/INDEX.md to index all active and archived documentation.
- Split TASK_NOTES.md and docs/site-audit-findings.md to reduce the agent's initial context load.
- Add a "SUPERSEDED" banner to Railway-era documentation files in docs/archive/.

## Repo detection
- Vite + React frontend with Express/TypeScript backend.
- Documentation folder located in docs/ containing plans/, archive/, and core files.

## Relevant files
- `AGENTS.md`
- `CLAUDE.md`
- `CLAUDE_TASK.md`
- `TASK_NOTES.md`
- `docs/INDEX.md`
- `docs/site-audit-findings.md`
- `docs/archive/*`

## Files to edit (STRICT)
- `CLAUDE_TASK.md`
- `TASK_NOTES.md`
- `docs/INDEX.md`
- `docs/site-audit-findings.md`
- `docs/archive/*`

## Acceptance criteria
- [x] docs/INDEX.md is programmatically generated and lists all md files.
- [x] TASK_NOTES.md size is reduced, with older entries moved to docs/archive/task-notes-<year>.md files.
- [x] docs/site-audit-findings.md size is reduced, with older entries moved to docs/archive/site-audit-findings-<year>.md files.
- [x] All Railway-era archive files have a clear "SUPERSEDED" banner.
- [x] The total context size of TASK_NOTES.md and docs/site-audit-findings.md is substantially reduced from ~850KB.
- [x] Baseline typecheck and build command runs successfully.

## Commands
- No build command is required for verification since only documentation was modified.
