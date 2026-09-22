#!/usr/bin/env node
/**
 * verify-rls-policy-reconciliation.mjs
 *
 * Watchtower task 82d4ae2e-cbfa-4331-9eda-51fa6a22d774 (Sifu, 2026-09-22).
 *
 * WHAT IT PROVES
 * --------------
 * Historical migrations in `supabase/migrations/` still CREATE wide-open RLS
 * policies (`USING (true)` / `WITH CHECK (true)` with no `TO` clause, i.e.
 * `TO public`, i.e. reachable with the anon key that ships in the frontend
 * bundle). Production had those dropped by hand in Aug 2026 and never got a
 * forward migration, so a `supabase db reset` / staging build / DR rebuild used
 * to come up WIDE OPEN while production was locked.
 *
 * This script replays every CREATE POLICY / DROP POLICY in
 * `supabase/migrations/` in filename order (the order the CLI applies them),
 * computes the resulting policy set, and asserts that no wide-open WRITE policy
 * survives. Public `FOR SELECT USING (true)` policies on genuinely public
 * catalogue tables are allow-listed by name below and are expected to survive.
 *
 * Static mode (default) needs no credentials and is safe in CI:
 *     node scripts/verify-rls-policy-reconciliation.mjs
 *
 * Live mode additionally diffs the replayed set against production `pg_policies`
 * (read-only; a single SELECT):
 *     node scripts/verify-rls-policy-reconciliation.mjs --live
 *
 * Live mode reads DATABASE_URL from backend/.env, which OVERRIDES any inherited
 * process.env value on purpose -- dispatch/CLI shells on this box inherit a
 * different project's Supabase credentials, and a silently shadowed connection
 * string is how you "verify" the wrong database. A git worktree does not carry
 * the shared checkout's untracked .env files, so from a worktree point it at one:
 *     node scripts/verify-rls-policy-reconciliation.mjs --live \
 *       --env="D:/Projects for MetaSphere/imagine-this-printed/backend/.env"
 *
 * Exit code 0 = reconciled, 1 = a wide-open policy survives the replay (or the
 * replayed set disagrees with live on a wide-open policy).
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'supabase', 'migrations')

/**
 * Public `FOR SELECT USING (true)` policies that are SUPPOSED to be public.
 * Each is read by the storefront through the anon client; dropping one is a
 * storefront outage, not a security fix. Keyed `table||policyname`.
 */
const ALLOWED_PUBLIC_READS = new Set([
  'products||Anyone can view products',
  'imagination_pricing||Anyone can read pricing',
  'imagination_products||Anyone can read imagination products',
  'imagination_product_sizes||Anyone can read imagination product sizes',
  'shipping_methods||shipping_methods_public_read',
  'social_votes||Anyone can view votes',
  'community_boosts||Anyone can view boosts',
  'agent_status||Anyone can check agent availability',
  'product_copurchase||Anyone can read product co-purchase data',
])

/**
 * Wide-open policies that are still LIVE in production. The job of the forward
 * migration is convergence with production, so these must survive the replay --
 * removing one is a live production change and needs its own reviewed migration.
 * Each entry carries the reason so this list cannot quietly become a dumping
 * ground.
 */
const KNOWN_LIVE_RESIDUALS = new Map([
  [
    'email_logs||Service can insert email logs',
    'FOR INSERT TO authenticated WITH CHECK (true). Live in production. No browser-client writer (all five writers are service-role backend paths), so it looks removable -- but removing it is a production change, tracked as its own follow-up.',
  ],
])

const CREATE_RE =
  /CREATE\s+POLICY\s+("([^"]+)"|[A-Za-z0-9_]+)\s+ON\s+([A-Za-z0-9_."]+)([\s\S]*?);/gi
const DROP_RE =
  /DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?("([^"]+)"|[A-Za-z0-9_]+)\s+ON\s+([A-Za-z0-9_."]+)\s*;/gi

const normTable = (t) =>
  t.trim().replace(/"/g, '').replace(/^public\./i, '').toLowerCase()

function parseCreate(body) {
  const flat = body.replace(/\s+/g, ' ')
  const cmd = (flat.match(/\bFOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\b/i)?.[1] ?? 'ALL').toUpperCase()
  const roles = (flat.match(/\bTO\s+([A-Za-z_, ]+?)(?=\s+USING|\s+WITH\s+CHECK|\s*$)/i)?.[1] ?? 'public')
    .trim()
    .toLowerCase()
  const using = flat.match(/\bUSING\s*\(([\s\S]*?)\)\s*(?:WITH\s+CHECK|$)/i)?.[1]?.trim() ?? null
  const check = flat.match(/\bWITH\s+CHECK\s*\(([\s\S]*)\)\s*$/i)?.[1]?.trim() ?? null
  return { cmd, roles, using, check, raw: flat.trim() }
}

/** Replay every migration in filename order and return the final policy set. */
function replayMigrations() {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
  const state = new Map()

  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
    const events = []

    CREATE_RE.lastIndex = 0
    for (const m of sql.matchAll(CREATE_RE)) {
      events.push({
        at: m.index,
        kind: 'CREATE',
        key: `${normTable(m[3])}||${(m[2] ?? m[1]).replace(/"/g, '')}`,
        meta: { file, table: normTable(m[3]), name: (m[2] ?? m[1]).replace(/"/g, ''), ...parseCreate(m[4]) },
      })
    }
    for (const m of sql.matchAll(DROP_RE)) {
      events.push({
        at: m.index,
        kind: 'DROP',
        key: `${normTable(m[3])}||${(m[2] ?? m[1]).replace(/"/g, '')}`,
      })
    }

    // Within one file, order matters: the repo's idempotent pattern is
    // DROP IF EXISTS immediately followed by CREATE.
    events.sort((a, b) => a.at - b.at)
    for (const e of events) {
      if (e.kind === 'CREATE') state.set(e.key, e.meta)
      else state.delete(e.key)
    }
  }
  return state
}

const isWideOpen = (p) =>
  String(p.using ?? '').trim().toLowerCase() === 'true' ||
  String(p.check ?? '').trim().toLowerCase() === 'true'

const reachesAnon = (p) => p.roles === 'public' || p.roles.split(/\s*,\s*/).includes('anon')

function readEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return null
  const raw = fs.readFileSync(envPath, 'utf8').replace(/^﻿/, '')
  const v = raw.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '')
  return v || null
}

function loadDatabaseUrl() {
  // --env=<path> wins: a git worktree does NOT carry the shared checkout's
  // untracked .env files, so a dispatch worktree has to be pointed at one.
  const flag = process.argv.find((a) => a.startsWith('--env='))?.slice('--env='.length)
  if (flag) {
    const v = readEnvFile(path.resolve(flag))
    if (v) return { url: v, source: `${flag} (--env)` }
    return null
  }
  for (const rel of [['backend', '.env'], ['.env']]) {
    const p = path.join(REPO_ROOT, ...rel)
    const v = readEnvFile(p)
    if (v) return { url: v, source: `${rel.join('/')} (overrides inherited env)` }
  }
  if (process.env.DATABASE_URL) return { url: process.env.DATABASE_URL, source: 'process.env (no .env file found)' }
  return null
}

async function fetchLivePolicies(url) {
  // pg >= 8.16 reads `sslmode=require` as `verify-full` and dies on Supabase's
  // chain with SELF_SIGNED_CERT_IN_CHAIN -- strip it and pass ssl explicitly.
  const { default: pg } = await import('pg')
  const u = new URL(url)
  u.searchParams.delete('sslmode')
  const client = new pg.Client({
    connectionString: u.toString(),
    ssl: { rejectUnauthorized: false },
    statement_timeout: 30_000,
  })
  await client.connect()
  try {
    const { rows } = await client.query(
      `SELECT tablename, policyname, cmd, roles::text AS roles, qual, with_check
         FROM pg_policies
        WHERE schemaname = 'public'
        ORDER BY tablename, policyname`,
    )
    return rows
  } finally {
    await client.end()
  }
}

async function main() {
  const live = process.argv.includes('--live')
  const state = replayMigrations()

  console.log('RLS policy reconciliation')
  console.log('=========================')
  console.log(`migrations dir : ${path.relative(REPO_ROOT, MIGRATIONS_DIR)}`)
  console.log(`replayed set   : ${state.size} policies`)
  console.log()

  const wideOpen = [...state.entries()].filter(([, p]) => isWideOpen(p))
  const failures = []
  const allowed = []

  for (const [key, p] of wideOpen) {
    if (KNOWN_LIVE_RESIDUALS.has(key)) {
      allowed.push([key, p, 'LIVE RESIDUAL'])
    } else if (p.cmd === 'SELECT' && ALLOWED_PUBLIC_READS.has(key)) {
      allowed.push([key, p, 'PUBLIC READ'])
    } else if (!reachesAnon(p) && p.cmd === 'SELECT') {
      allowed.push([key, p, 'NON-ANON SELECT'])
    } else {
      failures.push([key, p])
    }
  }

  console.log(`wide-open in replayed set : ${wideOpen.length}`)
  for (const [key, p, why] of allowed) {
    console.log(`  OK   ${key}  [${p.cmd} TO ${p.roles}]  ${why}  <- ${p.file}`)
  }
  for (const [key, p] of failures) {
    console.log(`  FAIL ${key}  [${p.cmd} TO ${p.roles}] using=${p.using} check=${p.check}  <- ${p.file}`)
  }
  console.log()

  if (live) {
    const db = loadDatabaseUrl()
    if (!db) {
      console.error('--live requested but no DATABASE_URL in backend/.env or process.env')
      process.exit(2)
    }
    console.log(`live source    : ${db.source}`)
    const rows = await fetchLivePolicies(db.url)
    const liveKeys = new Map(rows.map((r) => [`${r.tablename.toLowerCase()}||${r.policyname}`, r]))
    console.log(`live set       : ${rows.length} policies`)
    console.log()

    const liveWideOpen = rows.filter(
      (r) =>
        (String(r.qual ?? '').trim() === 'true' || String(r.with_check ?? '').trim() === 'true') &&
        (r.roles.includes('public') || r.roles.includes('anon')),
    )
    console.log(`wide-open LIVE in production : ${liveWideOpen.length}`)
    for (const r of liveWideOpen) {
      const key = `${r.tablename.toLowerCase()}||${r.policyname}`
      const known = ALLOWED_PUBLIC_READS.has(key) || KNOWN_LIVE_RESIDUALS.has(key)
      console.log(`  ${known ? 'OK  ' : 'NEW '} ${key} [${r.cmd} TO ${r.roles}]`)
      if (!known) failures.push([key, { file: 'LIVE', cmd: r.cmd, roles: r.roles, using: r.qual, check: r.with_check }])
    }
    console.log()

    // The convergence assertion: every wide-open policy the replay produces must
    // also be live, and vice versa. Narrow policies drift for unrelated reasons
    // (documented in MIGRATION_LEDGER.md) and are out of this check's scope.
    const replayWideKeys = new Set(wideOpen.map(([k]) => k))
    const liveWideKeys = new Set(liveWideOpen.map((r) => `${r.tablename.toLowerCase()}||${r.policyname}`))
    const onlyReplay = [...replayWideKeys].filter((k) => !liveWideKeys.has(k) && !KNOWN_LIVE_RESIDUALS.has(k))
    const onlyLive = [...liveWideKeys].filter((k) => !replayWideKeys.has(k))

    console.log('wide-open convergence (replay vs live)')
    for (const k of onlyReplay) {
      const tableExistsLive = rows.some((r) => r.tablename.toLowerCase() === k.split('||')[0])
      const note = tableExistsLive ? 'DIVERGENT -- table is live, policy is not' : 'table absent from production'
      console.log(`  replay-only : ${k}  (${note})`)
      if (tableExistsLive) failures.push([k, { file: 'REPLAY-ONLY', cmd: '?', roles: '?', using: '?', check: '?' }])
    }
    for (const k of onlyLive) console.log(`  live-only   : ${k}`)
    if (!onlyReplay.length && !onlyLive.length) console.log('  identical')
    console.log()

    // email_logs residual: assert it is still live, otherwise the allow-list lies.
    for (const [key, why] of KNOWN_LIVE_RESIDUALS) {
      const present = liveKeys.has(key)
      console.log(`residual ${present ? 'STILL LIVE' : 'GONE FROM LIVE'} : ${key}`)
      if (!present) {
        console.log('  -> production no longer has it; the forward migration should now drop it too.')
        failures.push([key, { file: 'RESIDUAL', cmd: '?', roles: '?', using: '?', check: '?' }])
      } else {
        console.log(`  -> ${why}`)
      }
    }
    console.log()
  }

  if (failures.length) {
    console.error(`FAIL: ${failures.length} unreconciled wide-open policy/policies.`)
    process.exit(1)
  }
  console.log('PASS: no unreconciled wide-open RLS policy in the migration chain.')
}

main().catch((err) => {
  console.error(err)
  process.exit(2)
})
