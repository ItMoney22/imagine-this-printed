#!/usr/bin/env node
// ---------------------------------------------------------------------------
// verify-anon-insert-lockdown.mjs
//
// Watchtower task 1e03d8e0-e3e1-4e7b-b4b2-d46233e4756f (Sifu).
// Companion to supabase/migrations/20260819210000_drop_public_insert_policies.sql.
//
// Answers one question against the LIVE database, from both sides:
//   can somebody holding nothing but the publishable anon key INSERT into
//   public.community_boost_earnings or public.user_profiles?
//
// Two independent checks, either of which can run alone:
//   CATALOG   (needs DATABASE_URL) -- read-only. Dumps every policy and every
//             anon grant on both tables and flags any INSERT policy that is
//             `TO public WITH CHECK (true)`.
//   POSTGREST (needs SUPABASE_URL + an anon key) -- fires a real POST at
//             /rest/v1/<table> carrying ONLY the anon key. Expected after the
//             migration: HTTP 401/403 with PostgreSQL SQLSTATE 42501.
//
// The POSTGREST probes are written to be non-destructive whichever side of the
// migration you run them on:
//   * user_profiles -- the probe row's id is a random uuid that cannot exist in
//     auth.users, so if RLS lets it through, user_profiles_id_fkey (23503)
//     stops it. A 23503 therefore means VULNERABLE (the policy said yes and a
//     constraint saved you); 42501 means LOCKED. Nothing is ever written.
//   * community_boost_earnings -- has no FK on creator_id, so a successful
//     insert really does land a row. If that happens the script reports
//     VULNERABLE and immediately deletes the row it created using DATABASE_URL
//     (or SUPABASE_SERVICE_ROLE_KEY), then verifies it is gone. Pass
//     --no-write to skip that probe entirely.
//
// TRAP, learned the hard way on 2026-08-19 -- send `Prefer: return=minimal`,
// never `return=representation`. With `return=representation` PostgREST reads
// the new row back, so the INSERT is additionally judged by the table's SELECT
// policy. community_boost_earnings' SELECT policy is auth.uid() = creator_id,
// which anon fails, so the wide-open table answered
//   HTTP 401 {"code":"42501","message":"new row violates row-level security
//   policy for table \"community_boost_earnings\""}
// -- indistinguishable from a properly locked table, while the same POST with
// `return=minimal` returned 201 and really wrote the row. A representation
// probe reports this vulnerability as fixed when it is wide open.
//
// Usage:
//   npm run verify:anon-insert
//   node scripts/verify-anon-insert-lockdown.mjs --no-write
//
// Credentials are read from the environment, falling back to backend/.env and
// .env.local when a var is not already set (anything already exported wins, so
// `node --env-file=... ` still works). Note that a dispatch git worktree does
// not carry those untracked .env files -- run it from the shared checkout, or
// export DATABASE_URL / SUPABASE_URL / SUPABASE_ANON_KEY yourself.
//
// Exit code 0 = locked down, 1 = a vulnerable path is still open (or a
// legitimate path broke), 2 = nothing could be checked.
// ---------------------------------------------------------------------------
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
for (const file of ['backend/.env', '.env.local', '.env']) {
  const path = join(REPO, file)
  if (!existsSync(path)) continue
  const before = { ...process.env }
  try {
    process.loadEnvFile(path)
    // loadEnvFile overwrites; put back anything that was already set so an
    // explicitly exported value always beats a file.
    for (const [k, v] of Object.entries(before)) process.env[k] = v
  } catch { /* unreadable/malformed .env is not fatal -- env may already carry it */ }
}

const TABLES = ['community_boost_earnings', 'user_profiles']
const NO_WRITE = process.argv.includes('--no-write')
const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok === null ? 'SKIP' : ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}`)
}

// --- catalog ---------------------------------------------------------------
let pgClient = null

async function connectPg() {
  if (!process.env.DATABASE_URL) return null
  const { default: pg } = await import('pg')
  // sslmode=require in the URL is read as verify-full by pg >= 8.16 and then
  // rejects Supabase's chain; strip it and set the TLS options explicitly.
  const url = new URL(process.env.DATABASE_URL)
  url.searchParams.delete('sslmode')
  const client = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } })
  await client.connect()
  return client
}

async function catalogCheck(client) {
  const { rows: policies } = await client.query(
    `SELECT tablename, policyname, cmd, roles::text AS roles, with_check
       FROM pg_policies
      WHERE schemaname = 'public' AND tablename = ANY($1)
      ORDER BY tablename, cmd, policyname`, [TABLES])
  console.log('\n  policies on the two tables:')
  for (const p of policies) {
    console.log(`    ${p.tablename.padEnd(26)} ${p.cmd.padEnd(6)} ${p.roles.padEnd(17)} ${p.policyname}`)
  }

  const { rows: wide } = await client.query(
    `SELECT tablename, policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = ANY($1)
        AND cmd = 'INSERT' AND with_check = 'true' AND 'public' = ANY (roles)`, [TABLES])
  record('catalog: no `TO public WITH CHECK (true)` INSERT policy remains',
    wide.length === 0,
    wide.length ? wide.map(w => `${w.tablename}."${w.policyname}"`).join(', ') : `${policies.length} policies inspected`)

  // The correctly-scoped self-insert policy must survive -- any first-party
  // "create my own profile row" path depends on it.
  record('catalog: "Users can insert own profile" survived on user_profiles',
    policies.some(p => p.tablename === 'user_profiles' && p.cmd === 'INSERT' && p.policyname === 'Users can insert own profile'),
    'WITH CHECK (auth.uid() = id)')

  const { rows: grants } = await client.query(
    `SELECT table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
       FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = ANY($1) AND grantee = 'anon'
      GROUP BY 1 ORDER BY 1`, [TABLES])
  console.log('\n  anon table grants (informational -- RLS is what gates them):')
  for (const g of grants) console.log(`    ${g.table_name.padEnd(26)} ${g.privs}`)
}

// --- postgrest -------------------------------------------------------------
function anonKeys() {
  const seen = new Map()
  for (const name of ['SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY']) {
    const v = process.env[name]
    if (v && !seen.has(v)) seen.set(v, name)
  }
  return [...seen.entries()].map(([key, name]) => ({ key, name }))
}

function restBase() {
  return (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
}

async function postAsAnon(key, table, body) {
  const res = await fetch(`${restBase()}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      // return=minimal on purpose -- see the TRAP note at the top of this file.
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* non-JSON body */ }
  return { status: res.status, code: json?.code ?? null, message: json?.message ?? text.slice(0, 160), json }
}

async function postgrestCheck(keyName, key) {
  console.log(`\n  POSTing as anon using ${keyName} -> ${restBase()}`)

  // 1. user_profiles -- unsatisfiable FK, so nothing can ever be written.
  const probeId = randomUUID()
  const prof = await postAsAnon(key, 'user_profiles', {
    id: probeId,
    email: `rls-probe-${probeId.slice(0, 8)}@example.invalid`,
    role: 'admin',
  })
  record(`postgrest[${keyName}]: POST /rest/v1/user_profiles rejected with 42501`,
    prof.code === '42501',
    `HTTP ${prof.status} code=${prof.code ?? 'none'}`
      + (prof.code === '23503' ? ' <- RLS ALLOWED IT; only the auth.users FK stopped the write' : '')
      + (prof.status < 300 ? ' <- ROW WAS CREATED' : ''))
  if (prof.status < 300) await cleanup('user_profiles', 'id', probeId)

  // 2. community_boost_earnings -- a real write if RLS permits it. return=minimal
  // gives back no body, so the probe is tracked by the creator_id we chose.
  if (NO_WRITE) {
    record(`postgrest[${keyName}]: POST /rest/v1/community_boost_earnings rejected with 42501`, null, '--no-write')
    return
  }
  const creatorId = randomUUID()
  const boost = await postAsAnon(key, 'community_boost_earnings', {
    creator_id: creatorId, boost_type: 'free_vote', itc_earned: 1, status: 'failed',
  })
  record(`postgrest[${keyName}]: POST /rest/v1/community_boost_earnings rejected with 42501`,
    boost.code === '42501',
    `HTTP ${boost.status} code=${boost.code ?? 'none'}` + (boost.status < 300 ? ' <- ROW WAS CREATED' : ''))
  await cleanup('community_boost_earnings', 'creator_id', creatorId, boost.status < 300)
}

// Deletes anything the probe managed to write and proves it is gone. Called
// even when the probe was refused -- a no-op delete is the cheapest way to be
// certain nothing leaked through -- so `wrote` says whether a missing cleanup
// credential is merely inconvenient or an actual "go remove this row" alarm.
async function cleanup(table, column, value, wrote = true) {
  if (pgClient) {
    const del = await pgClient.query(`DELETE FROM public.${table} WHERE ${column} = $1`, [value])
    const { rows } = await pgClient.query(`SELECT count(*)::int AS n FROM public.${table} WHERE ${column} = $1`, [value])
    if (rows[0].n !== 0) throw new Error(`probe row still present in ${table} after cleanup -- REMOVE IT BY HAND (${column}=${value})`)
    if (del.rowCount > 0) console.log(`      cleaned up: deleted ${del.rowCount} probe row(s) from ${table} (via DATABASE_URL)`)
    return
  }
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!svc) {
    if (!wrote) return // nothing was written and nothing to sweep with -- fine
    throw new Error(`cannot clean up ${table} (${column}=${value}) -- no DATABASE_URL and no service key. REMOVE IT BY HAND`)
  }
  const res = await fetch(`${restBase()}/rest/v1/${table}?${column}=eq.${value}`, {
    method: 'DELETE', headers: { apikey: svc, Authorization: `Bearer ${svc}` },
  })
  if (!res.ok) {
    const msg = `cleanup of ${table} (${column}=${value}) returned ${res.status}`
    if (!wrote) { console.log(`      note: ${msg} -- nothing was written, so nothing to remove`); return }
    throw new Error(`${msg} -- REMOVE IT BY HAND`)
  }
  console.log(`      cleanup sweep on ${table} (${column}=${value}) ok`)
}

// --- main ------------------------------------------------------------------
console.log('anon INSERT lockdown check -- community_boost_earnings + user_profiles\n')
let ran = false
try {
  pgClient = await connectPg()
  if (pgClient) {
    await catalogCheck(pgClient)
    ran = true
  } else {
    console.log('SKIP  catalog check (no DATABASE_URL in env)')
  }

  const keys = anonKeys()
  if (!keys.length || !restBase()) {
    console.log('SKIP  postgrest check (need SUPABASE_URL + SUPABASE_ANON_KEY / VITE_SUPABASE_ANON_KEY)')
  } else {
    for (const { key, name } of keys) {
      await postgrestCheck(name, key)
      ran = true
    }
  }
} finally {
  if (pgClient) await pgClient.end()
}

const failed = results.filter(r => r.ok === false)
console.log(`\n${results.filter(r => r.ok === true).length} passed / ${failed.length} failed / ${results.filter(r => r.ok === null).length} skipped`)
if (!ran) {
  console.error('nothing could be checked -- no credentials in env')
  process.exit(2)
}
process.exit(failed.length ? 1 : 0)
