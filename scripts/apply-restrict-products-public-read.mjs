#!/usr/bin/env node
/**
 * Apply 20261012210000_restrict_products_public_read.sql to production in ONE
 * transaction, with proof taken inside that transaction before it commits.
 *
 * Watchtower task 7e54a10f-bbe6-47ab-b5ec-0123c4c7b688 (Cole Iverson, 2026-10-12).
 *
 *   node scripts/apply-restrict-products-public-read.mjs --env=<path to backend/.env>           dry run, always rolled back
 *   node scripts/apply-restrict-products-public-read.mjs --env=<path to backend/.env> --apply   commits + records the version
 *
 * Inside the transaction it snapshots pg_policies for the four tables, runs the
 * migration file verbatim, snapshots again, then measures what anon, a signed-in
 * customer, a draft's owner and an admin can SELECT (SET LOCAL ROLE +
 * request.jwt.claims, the same thing PostgREST does per request). Any probe
 * that does not match the expected visibility aborts and rolls back, --apply or
 * not. On --apply the row goes into supabase_migrations.schema_migrations in
 * the same transaction, so the policy change and its ledger row land together.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const VERSION = '20261012210000'
const NAME = 'restrict_products_public_read'
const FILE = path.join(REPO_ROOT, 'supabase', 'migrations', `${VERSION}_${NAME}.sql`)
const TABLES = ['products', 'imagination_products', 'imagination_product_sizes', 'shipping_methods']
const apply = process.argv.includes('--apply')

function databaseUrl() {
  // Same rule as verify-rls-policy-reconciliation.mjs: the env FILE wins over an
  // inherited process.env, which on this box can belong to another project.
  const flag = process.argv.find((a) => a.startsWith('--env='))?.slice('--env='.length)
  const envPath = flag ? path.resolve(flag) : path.join(REPO_ROOT, 'backend', '.env')
  if (!fs.existsSync(envPath)) throw new Error(`no env file at ${envPath}`)
  const v = fs.readFileSync(envPath, 'utf8').match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '')
  if (!v) throw new Error(`no DATABASE_URL in ${envPath}`)
  const u = new URL(v)
  u.searchParams.delete('sslmode')
  return u.toString()
}

const snapshot = async (c) =>
  (
    await c.query(
      `SELECT tablename, policyname, cmd, roles::text AS roles, qual, with_check
         FROM pg_policies
        WHERE schemaname = 'public' AND tablename = ANY($1)
        ORDER BY tablename, policyname`,
      [TABLES],
    )
  ).rows

const sig = (r) => `${r.tablename}||${r.policyname}||${r.cmd}||${r.roles}||${r.qual}||${r.with_check}`

async function asRole(c, role, sub) {
  await c.query('RESET ROLE')
  await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(sub ? { sub, role } : { role })])
  await c.query(`SET LOCAL ROLE ${role}`)
}

async function main() {
  const sql = fs.readFileSync(FILE, 'utf8')
  const { default: pg } = await import('pg')
  const c = new pg.Client({ connectionString: databaseUrl(), ssl: { rejectUnauthorized: false }, statement_timeout: 60_000 })
  await c.connect()
  const one = async (q, p) => (await c.query(q, p)).rows[0]
  let committed = false
  try {
    await c.query('BEGIN')
    const already = await one(`SELECT version FROM supabase_migrations.schema_migrations WHERE version = $1`, [VERSION])
    if (already) console.log(`NOTE: version ${VERSION} is already recorded in schema_migrations`)

    const totalBefore = (await one(`SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'public'`)).n
    const before = await snapshot(c)
    await c.query(sql)
    const after = await snapshot(c)
    const totalAfter = (await one(`SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'public'`)).n

    const b = new Set(before.map(sig))
    const a = new Set(after.map(sig))
    console.log(`public policies: ${totalBefore} before, ${totalAfter} after`)
    console.log('removed:')
    for (const r of before) if (!a.has(sig(r))) console.log(`  - ${r.tablename} | ${r.policyname} | ${r.cmd} ${r.roles} | ${r.qual ?? ''}`)
    console.log('added:')
    for (const r of after) if (!b.has(sig(r))) console.log(`  + ${r.tablename} | ${r.policyname} | ${r.cmd} ${r.roles} | ${r.qual ?? r.with_check ?? ''}`)
    const unchanged = after.filter((r) => b.has(sig(r))).length
    console.log(`unchanged (dropped and re-created identically, or untouched): ${unchanged}`)
    console.log()

    // ---- probe, inside the transaction --------------------------------------
    const truth = await one(`SELECT count(*)::int AS total,
                                    count(*) FILTER (WHERE approved IS TRUE AND status = 'active')::int AS published
                               FROM public.products`)
    const admin = await one(`SELECT id FROM public.user_profiles WHERE role = 'admin' ORDER BY created_at LIMIT 1`)
    const vendor = await one(`SELECT id FROM public.user_profiles WHERE role = 'vendor' LIMIT 1`)
    const owner = await one(`SELECT p.created_by_user_id AS id FROM public.products p
                               JOIN public.user_profiles up ON up.id = p.created_by_user_id
                              WHERE NOT (p.approved IS TRUE AND p.status = 'active') AND up.role NOT IN ('admin', 'manager')
                              LIMIT 1`)
    const expectFor = async (uid) =>
      (await one(`SELECT count(*)::int AS n FROM public.products
                   WHERE (approved IS TRUE AND status = 'active') OR created_by_user_id = $1 OR vendor_id = $1`, [uid])).n
    const publicTruth = await one(`SELECT (SELECT count(*) FROM public.imagination_products)::int AS ip,
                                          (SELECT count(*) FROM public.imagination_product_sizes)::int AS ips,
                                          (SELECT count(*) FROM public.shipping_methods)::int AS sm`)
    const cases = [
      { label: 'anon', role: 'anon', sub: null, expect: truth.published },
      { label: 'signed-in customer (no rows)', role: 'authenticated', sub: '00000000-0000-4000-8000-00000000c0de', expect: truth.published },
    ]
    if (owner) cases.push({ label: 'draft owner (non-staff)', role: 'authenticated', sub: owner.id, expect: await expectFor(owner.id) })
    if (vendor) cases.push({ label: 'vendor', role: 'authenticated', sub: vendor.id, expect: await expectFor(vendor.id) })
    if (admin) cases.push({ label: 'admin', role: 'authenticated', sub: admin.id, expect: truth.total })

    const failures = []
    console.log(`products: ${truth.total} rows, ${truth.published} published`)
    for (const k of cases) {
      await asRole(c, k.role, k.sub)
      const seen = (await one(`SELECT count(*)::int AS n FROM public.products`)).n
      const ok = seen === k.expect
      console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${k.label.padEnd(30)} sees ${seen} (expected ${k.expect})`)
      if (!ok) failures.push(k.label)
    }
    await asRole(c, 'anon', null)
    const anonPublic = await one(`SELECT (SELECT count(*) FROM public.imagination_products)::int AS ip,
                                         (SELECT count(*) FROM public.imagination_product_sizes)::int AS ips,
                                         (SELECT count(*) FROM public.shipping_methods)::int AS sm`)
    // The storefront's own catalog query, as anon: published rows only and none lost.
    const anonCatalog = (await one(`SELECT count(*)::int AS n FROM public.products WHERE status = 'active' AND is_active = true`)).n
    await c.query('RESET ROLE')
    const catalogTruth = (await one(`SELECT count(*)::int AS n FROM public.products WHERE status = 'active' AND is_active = true`)).n
    for (const [k, label] of [['ip', 'imagination_products'], ['ips', 'imagination_product_sizes'], ['sm', 'shipping_methods']]) {
      const ok = anonPublic[k] === publicTruth[k]
      console.log(`  ${ok ? 'OK  ' : 'FAIL'} anon ${label.padEnd(26)} sees ${anonPublic[k]} of ${publicTruth[k]}`)
      if (!ok) failures.push(label)
    }
    const catOk = anonCatalog === catalogTruth
    console.log(`  ${catOk ? 'OK  ' : 'FAIL'} anon storefront catalog query     returns ${anonCatalog} of ${catalogTruth} active rows`)
    if (!catOk) failures.push('catalog')
    console.log()

    if (failures.length) throw new Error(`probe failed: ${failures.join(', ')} -- rolled back`)

    if (!apply) {
      await c.query('ROLLBACK')
      console.log('DRY RUN: rolled back. Re-run with --apply to commit.')
      return
    }
    await c.query(
      `INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
       VALUES ($1, $2, ARRAY[$3]) ON CONFLICT (version) DO NOTHING`,
      [VERSION, NAME, sql],
    )
    await c.query('COMMIT')
    committed = true
    console.log(`APPLIED + recorded ${VERSION} ${NAME} in supabase_migrations.schema_migrations`)
  } catch (err) {
    if (!committed) await c.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    await c.end()
  }
}

main().catch((err) => {
  console.error(err?.message || err)
  process.exit(1)
})
