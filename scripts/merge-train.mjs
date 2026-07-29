#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Merge train — sweeps finished branches into main through a safety gate.
//
// Why (David 2026-07-28, built 2026-07-29): the dispatch fleet isolates every
// task in its own worktree, but nothing drove MERGING on a cadence — ~36
// finished branches sat unmerged, work stranded, mega-branches formed. This
// script is the cadence.
//
// v2 (same day): the train owns its environment. v1 junctioned node_modules
// from the shared checkout, and a concurrent session's npm reinstall emptied
// it mid-run — the gate failed on missing tools, not code. Now the train
// keeps a PERSISTENT worktree at ~/.itp-merge-train/wt with its own installed
// deps, `npm ci`-refreshed only when the lockfiles change.
//
// Per run:
//   1. fetch --prune; candidates = remote branches NOT merged into
//      origin/main, tip quiet >= MIN_AGE_H hours, oldest first.
//   2. PRE-FLAG (never auto-merge): branches touching supabase/migrations/**
//      or backend/prisma/** — DB changes need a human to apply the migration
//      before the code ships.
//   3. In the train worktree (reset --hard origin/main): trial-merge each
//      candidate --no-ff. Conflict -> flag. Clean -> typecheck backend +
//      frontend. Fail -> drop the merge + flag. Green -> train advances.
//   4. Up to MAX_MERGES greens per run; real mode pushes ONCE at the end
//      (one deploy). Push rejection (main moved) aborts safely — no force.
//   5. Board task with the summary (best effort).
//
// Usage:  node scripts/merge-train.mjs [--dry-run] [--max=N]
// Env:    MERGE_TRAIN_MIN_AGE_H (default 6), MERGE_TRAIN_MAX (default 8)
// ---------------------------------------------------------------------------
import { execSync, execFileSync } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import os from 'os'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const DRY = process.argv.includes('--dry-run')
const MAX_MERGES = Number((process.argv.find(a => a.startsWith('--max=')) || '').split('=')[1] || process.env.MERGE_TRAIN_MAX || 8)
const MIN_AGE_H = Number(process.env.MERGE_TRAIN_MIN_AGE_H || 6)
const TRAIN_DIR = join(os.homedir(), '.itp-merge-train')
const WT = join(TRAIN_DIR, 'wt')
const DEPS_STAMP = join(TRAIN_DIR, 'deps.hash')
const BOARD_ENV = 'D:/Projects for MetaSphere/david-trinidad-com/.env.local'

const sh = (cmd, opts = {}) =>
  execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim()
const git = (args, cwd = REPO) => sh(`git ${args}`, { cwd })
const log = (m) => console.log(`[train] ${m}`)

const merged = []
const flagged = []   // { branch, reason, detail }
const errText = (e) => [e?.stdout, e?.stderr, e?.message].map(x => (x ? String(x) : '')).filter(Boolean).join(' | ')

function flag(branch, reason, detail = '') {
  flagged.push({ branch, reason, detail: detail.slice(0, 400) })
  log(`FLAG ${branch}: ${reason}${detail ? ' — ' + detail.split('\n')[0].slice(0, 160) : ''}`)
}

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

// -- pre-flag migration branches (cheap, no merge needed)
const gated = []
for (const c of candidates) {
  let migrations = ''
  try {
    migrations = git(`diff --name-only origin/main...${c.ref} -- supabase/migrations backend/prisma`)
  } catch (e) {
    flag(c.ref, 'diff-failed', errText(e)); continue
  }
  if (migrations) flag(c.ref, 'migrations', `touches: ${migrations.split('\n').slice(0, 5).join(', ')} — needs human DB review/apply before merge`)
  else gated.push(c)
}

if (gated.length) {
  // -- persistent train worktree, reset to origin/main
  mkdirSync(TRAIN_DIR, { recursive: true })
  if (!existsSync(join(WT, '.git'))) {
    try { git('worktree prune') } catch { /* fine */ }
    git(`worktree add "${WT}" origin/main --detach`)
  }
  try { git('merge --abort', WT) } catch { /* nothing in progress */ }
  git('reset --hard origin/main', WT)
  git('clean -fd', WT) // does NOT touch gitignored node_modules

  // -- deps the train OWNS: npm ci only when the lockfiles change
  const lockHash = createHash('sha256')
    .update(readFileSync(join(WT, 'package-lock.json')))
    .update(readFileSync(join(WT, 'backend', 'package-lock.json')))
    .digest('hex')
  const tscPath = join(WT, 'node_modules', 'typescript', 'bin', 'tsc')
  const depsStale = !existsSync(tscPath)
    || !existsSync(join(WT, 'backend', 'node_modules'))
    || !existsSync(DEPS_STAMP)
    || readFileSync(DEPS_STAMP, 'utf8') !== lockHash
  if (depsStale) {
    log('installing train-owned deps (npm ci root + backend — first run or lockfile change)…')
    sh('npm ci --no-audit --no-fund', { cwd: WT, timeout: 15 * 60_000 })
    sh('npm ci --no-audit --no-fund', { cwd: join(WT, 'backend'), timeout: 15 * 60_000 })
    writeFileSync(DEPS_STAMP, lockHash)
    log('deps ready')
  }

  const typecheck = () => {
    execFileSync(process.execPath, [tscPath, '--noEmit'],
      { cwd: join(WT, 'backend'), stdio: ['ignore', 'pipe', 'pipe'], timeout: 5 * 60_000 })
    execFileSync(process.execPath, [tscPath, '--noEmit'],
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
      flag(c.ref, 'merge-conflict', errText(e))
      continue
    }
    try {
      typecheck()
    } catch (e) {
      git(`reset --hard ${trainHead}`, WT)
      flag(c.ref, 'typecheck-failed', errText(e))
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
      flag('(push)', 'push-rejected', 'main moved during the run; nothing shipped, next run retries. ' + errText(e))
      merged.length = 0
    }
  }
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
      body: JSON.stringify({
        title: `Merge train${DRY ? ' (dry run)' : ''}: ${merged.length} merged, ${flagged.length} flagged`,
        description: summary.slice(0, 3500),
        priority: flagged.some(f => f.reason === 'push-rejected') ? 'high' : 'medium',
        assigned_agent: 'zero',
        source: 'jimmy-mcp',
        status: 'pending'
      })
    })
    const body = await res.text()
    log(`board task: ${res.ok ? 'filed' : `HTTP ${res.status} ${body.slice(0, 200)}`}`)
  }
} catch (e) {
  log(`board post skipped: ${e.message}`)
}

process.exit(0)
