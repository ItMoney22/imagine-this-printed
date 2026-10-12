#!/usr/bin/env node
// The ONE database step of the e14d239c merge batch, run right after its deploy is live.
//
//   node docs/ship-proof-merge-batch-e14d239c-2026-10-12/apply-after-deploy.cjs --dry-run   (rolled back, writes nothing)
//   node docs/ship-proof-merge-batch-e14d239c-2026-10-12/apply-after-deploy.cjs --apply
//
// What it does, in one transaction:
//   1. 20261013120000_itc_refund_guard.sql — NEW on prod: refund_itc_for_debit() + the one-refund-per-debit unique
//      index. The deployed route already refuses unbound refunds without it (route-level checks); the function makes
//      the credit + ledger row atomic.
//   2. 20261013120100_crm_customer_aggregates.sql — the four crm_* functions are ALREADY live and byte-identical
//      (applied 2026-09-22; its ledger insert lost to the 20260922170000 version collision). Re-running is a no-op
//      CREATE OR REPLACE that re-asserts the service-role-only grants.
//   3. Ledger rows for both versions in supabase_migrations.schema_migrations (ON CONFLICT DO NOTHING).
// Then it checks anon/authenticated cannot EXECUTE either set of functions, and commits (or rolls back on --dry-run).
//
// It refuses to --apply until the refund guard merge (abe10ca) is on origin/main, so it can never run ahead of the
// code that reads it. SQL is read from origin/main with `git show`, so the function bodies carry LF line endings.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')
const MODE = process.argv.includes('--apply') ? 'apply' : process.argv.includes('--dry-run') ? 'dry-run' : null
if (!MODE) { console.error('usage: apply-after-deploy.cjs --dry-run | --apply'); process.exit(2) }

const git = (...args) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' })
git('fetch', 'origin', '-q')
const shipped = (() => { try { git('merge-base', '--is-ancestor', 'abe10ca', 'origin/main'); return true } catch { return false } })()
if (MODE === 'apply' && !shipped) {
  console.error('REFUSED: the refund guard merge abe10ca is not on origin/main yet. Ship the batch first.')
  process.exit(1)
}
const ref = shipped ? 'origin/main' : 'HEAD'
const MIGRATIONS = [
  { version: '20261013120000', name: 'itc_refund_guard' },
  { version: '20261013120100', name: 'crm_customer_aggregates' },
]

const envTxt = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8')
const raw = (envTxt.match(/^DATABASE_URL=(.*)$/m) || [])[1]
if (!raw) { console.error('backend/.env has no DATABASE_URL'); process.exit(1) }
const url = new URL(raw.trim().replace(/^"|"$/g, ''))
url.searchParams.delete('sslmode'); url.searchParams.delete('pgbouncer')
const { Client } = require(path.join(ROOT, 'node_modules', 'pg'))

;(async () => {
  const c = new Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } })
  await c.connect()
  await c.query('BEGIN')
  let commit = false
  try {
    await c.query("SET LOCAL lock_timeout = '5s'")
    for (const m of MIGRATIONS) {
      const sql = git('show', `${ref}:supabase/migrations/${m.version}_${m.name}.sql`)
      await c.query(sql)
      await c.query(
        'INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING',
        [m.version, m.name]
      )
      console.log(`applied ${m.version}_${m.name} (from ${ref})`)
    }
    const { rows } = await c.query(`
      select p.proname,
             has_function_privilege('anon', p.oid, 'execute') anon,
             has_function_privilege('authenticated', p.oid, 'execute') authd,
             has_function_privilege('service_role', p.oid, 'execute') svc
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and (p.proname = 'refund_itc_for_debit' or p.proname like 'crm\\_%')
       order by 1`)
    console.table(rows)
    const open = rows.filter(r => r.anon || r.authd || !r.svc)
    if (rows.length < 5 || open.length) throw new Error(`grant check failed: ${JSON.stringify(open)} (found ${rows.length} functions)`)
    const idx = await c.query("select indexname from pg_indexes where indexname = 'itc_transactions_one_refund_per_debit'")
    if (!idx.rows.length) throw new Error('itc_transactions_one_refund_per_debit was not created (duplicate refund rows?) — reconcile first')
    const ledger = await c.query("select version, name from supabase_migrations.schema_migrations where version in ('20261013120000','20261013120100') order by 1")
    console.log('ledger:', JSON.stringify(ledger.rows))
    commit = MODE === 'apply'
  } finally {
    await c.query(commit ? 'COMMIT' : 'ROLLBACK')
    console.log(commit ? 'COMMITTED' : 'ROLLED BACK (nothing written)')
    await c.end()
  }
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
