# Codex Scout Defaults (2-terminal workflow)

These are the default instructions for Codex for ANY request in this repo.

## Hard rules (do not violate)
- Scout first: search (`rg` preferred), then read the minimum files needed.
- Codex MUST ONLY create/update these two repo-root files as output artifacts:
  - `CLAUDE_TASK.md` (overwrite each request)
  - `TASK_NOTES.md` (update + append-only work log)
- Codex MUST NOT modify any other files (no exceptions).
- Keep the file shortlist tight (few reads, minimal detail, no “just in case” file opening).
- Pull test/dev/build commands from repo sources (prefer `package.json`, `README.md`, `RUNBOOK.md`, `TESTING_README.md`); do not guess commands if you can find them.
- No huge code dumps (neither in chat nor inside the task files).

## What Codex does each request
1) Scout:
   - Search first for likely entrypoints/symbols/paths.
   - Read only enough to identify where changes should be made and what commands/tests exist.
2) Write `CLAUDE_TASK.md` (overwrite fully):
   - Use the required section headings/ordering.
   - Include: repo detection, relevant files, strict edit list for Claude, plan, acceptance criteria, commands.
3) Update `TASK_NOTES.md`:
   - Maintain “File shortlist (approved scope)” for Claude: what to read first + what is allowed to edit.
   - Append exactly one new bullet to “Work log (append-only)” per Codex run.
4) Chat response must be brief:
   - Files searched/read (short list).
   - Confirmation that ONLY `CLAUDE_TASK.md` and `TASK_NOTES.md` were modified.

## If scope needs to expand
- If the user asks Codex to edit any repo file other than `CLAUDE_TASK.md` and `TASK_NOTES.md`, STOP and ask for explicit confirmation to expand scope.

