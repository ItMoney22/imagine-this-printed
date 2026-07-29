#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Merge train — sweeps finished branches into main through a safety gate.
//
// Why (David 2026-07-28, built 2026-07-29): the dispatch fleet isolates every
// task in its own worktree, but nothing drove MERGING on a cadence — ~36
// finished branches sat unmerged, work stranded, mega-branches formed. This
// script is the cadence.
//
// What it does, per run:
//   1. fetch --prune; list remote branches NOT merged into origin/main whose
//      tip is at least MIN_AGE_H hours old (quiet = probably finished),
//      oldest first.
//   2. PRE-FLAG (skip, never auto-merge): branches whose diff vs main touches
//      supabase/migrations/** or backend/prisma/** — DB changes need a human
//      to apply the migration before the code ships.
//   3. In a scratch worktree of origin/main (node_modules junctioned in from
//      the main checkout): trial-merge each candidate with --no-ff.
//      Conflict -> abort + flag. Clean -> typecheck backend + frontend.
//      Fail -> drop the merge + flag. Green -> the train advances (the next
//      branch trials against main + everything merged so far).
//   4. Up to MAX_MERGES green branches per run. Real mode pushes ONCE at the
//      end (one deploy on Render + Vercel), fast-forwarding origin/main to
//      the train head. Push rejection (main moved mid-run) aborts safely —
//      nothing is force-pushed, the next run starts fresh.
//   5. Files a board task with the summary (best-effort).
//
// Usage:  node scripts/merge-train.mjs [--dry-run] [--max=N]
// Env:    MERGE_TRAIN_MIN_AGE_H (default 6), MERGE_TRAIN_MAX (default 8)
// ---------------------------------------------------------------------------
import { execSync, execFileSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import os from 'os'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const DRY = process.argv.includes('--dry-run')
const MAX_MERGES = Number((process.argv.find(a => a.startsWith('--max=')) || '').split('=')[1] || process.env.MERGE_TRAIN_MAX || 8)
const MIN_AGE_H = Number(process.env.MERGE_TRAIN_MIN_AGE_H || 6)
const WT = join(os.tmpdir(), `itp-merge-train-${Date.now()}`)
const BOARD_ENV = 'D:/Projects for MetaSphere/david-trinidad-com/.env.local'

const sh = (cmd, opts = {}) =>
  execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim()
const git = (args, cwd = REPO) => sh(`git ${args}`, { cwd })
const log = (m) => console.log(`[train] ${m}`)

const merged = []
const flagged = []   // { branch, reason, detail }

function flag(branch, reason, detail = '') {
  flagged.push({ branch, reason, detail: detail.slice(0, 400) })
  log(`FLAG ${branch}: ${reason}${detail ? ' — ' + detail.split('\n')[0].slice(0, 120) : ''}`)
}

try {
  log(`mode=${DRY ? 'DRY RUN (no pushes)' : 'REAL'} max=${MAX_MERGES} minAge=${MIN_AGE_H}h`)
  git('fetch origin --prune')

  // -- candidates: remote branches not merged into origin/main, oldest tip first
  const now = Math.floor(Date.now() / 1000)
  const raw = git(`branch -r --no-merged origin/main --format="%(refname:short)|%(committerdate:unix)"`)
  const candidates = raw.split('\n').filter(Boolean)
    .map(l => { const [ref, date] = l.replace(/"/g, '').split('|'); return { ref, date: Number(date) } })
    .filter(c => c.ref.startsWith('origin/') && !/origin\/(main|HEAD)$/.test(c.ref))
    .filter(c => now - c.date >= MIN_AGE_H * 3600)
    .sort((a, b) => a.date - b.date)
  log(`${candidates.length} candidate branch(es) past the ${MIN_AGE_H}h quiet threshold`)
  if (!candidates.length) process.exit(0)

  // -- pre-flag migration branches (cheap, no merge needed)
  const gated = []
  for (const c of candidates) {
    let migrations = ''
    try {
      migrations = git(`diff --name-only origin/main...${c.ref} -- supabase/migrations backend/prisma`)
    } catch (e) {
      flag(c.ref, 'diff-failed', String(e.message)); continue
    }
    if (migrations) flag(c.ref, 'migrations', `touches: ${migrations.split('\n').slice(0, 5).join(', ')} — needs human DB review/apply before merge`)
    else gated.push(c)
  }

  // -- scratch worktree on origin/main with junctioned deps
  git(`worktree add "${WT}" origin/main --detach`)
  for (const [linkRel, targetRel] of [['node_modules', 'node_modules'], [join('backend', 'node_modules'), join('backend', 'node_modules')]]) {
    const target = join(REPO, targetRel)
    if (existsSync(target)) symlinkSync(target, join(WT, linkRel), 'junction')
  }

  const typecheck = () => {
    execFileSync(process.execPath, [join(WT, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit'],
      { cwd: join(WT, 'backend'), stdio: ['ignore', 'pipe', 'pipe'], timeout: 5 * 60_000 })
    execFileSync(process.execPath, [join(WT, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit'],
      { cwd: WT, stdio: ['ignore', 'pipe', 'pipe'], timeout: 5 * 60_000 })
  }

  let trainHead = git('rev-parse HEAD', WT)
  for (const c of gated) {
    if (merged.length >= MAX_MERGES) { log(`cap of ${MAX_MERGES} reached — remaining branches wait for the next run`); break }
    log(`gate: ${c.ref}`)
    try {
      git(`merge --no-ff --no-edit ${c.ref}`, WT)
    } catch (e) {
      try { git('merge --abort', WT) } catch { /* nothing to abort */ }
      flag(c.ref, 'merge-conflict', String(e.stderr || e.message))
      continue
    }
    try {
      typecheck()
    } catch (e) {
      git(`reset --hard ${trainHead}`, WT)
      flag(c.ref, 'typecheck-failed', String(e.stdout || e.message))
      continue
    }
    trainHead = git('rev-parse HEAD', WT)
    merged.push(c.ref)
    log(`GREEN ${c.ref} — train advances (${merged.length}/${MAX_MERGES})`)
  }

  // -- push once (real mode only)
  if (merged.length && !DRY) {
    try {
      git(`push origin HEAD:main`, WT)
      log(`pushed ${merged.length} merge(s) to main — one deploy`)
    } catch (e) {
      flag('(push)', 'push-rejected', 'main moved during the run; nothing shipped, next run retries. ' + String(e.stderr || e.message))
      merged.length = 0
    }
  }
} finally {
  try { git(`worktree remove "${WT}" --force`) } catch { /* best effort */ }
  try { rmSync(WT, { recursive: true, force: true }) } catch { /* best effort */ }
}

// -- summary + board task (best effort)
const summary = [
  `Merge train ${DRY ? '(dry run) ' : ''}— merged ${merged.length}, flagged ${flagged.length}.`,
  merged.length ? `MERGED:\n${merged.map(b => `  - ${b}`).join('\n')}` : '',
  flagged.length ? `FLAGGED:\n${flagged.map(f => `  - ${f.branch} [${f.reason}] ${f.detail.split('\n')[0]}`).join('\n')}` : ''
].filter(Boolean).join('\n')
console.log('\n' + summary)

try {
  const env = readFileSync(BOARD_ENV, 'utf8')
  const secret = (env.match(/^CRON_SECRET=(.+)$/m) || [])[1]
  if (secret && (merged.length || flagged.length)) {
    const res = await fetch('https://davidtrinidad.com/api/tasks/internal', {
      method: 'POST',
      headers: { 'x-internal-secret': secret.trim(), 'Content-Type': 'application/json' },
      // No `project` field: the 2026-07-29 dry run 500'd with it set to
      // 'imagine-this-printed' — the board defaults the project when omitted.
      body: JSON.stringify({
        title: `Merge train${DRY ? ' (dry run)' : ''}: ${merged.length} merged, ${flagged.length} flagged`,
        description: summary.slice(0, 3500),
        priority: flagged.some(f => f.reason === 'push-rejected') ? 'high' : 'medium',
        assigned_agent: 'zero',
        source: 'jimmy-mcp',
        status: 'pending'
      })
    })
    log(`board task: ${res.ok ? 'filed' : `HTTP ${res.status}`}`)
  }
} catch (e) {
  log(`board post skipped: ${e.message}`)
}

process.exit(0)
