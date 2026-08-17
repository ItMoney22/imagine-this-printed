#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Apply the migrations that MIGRATION_LEDGER.md flags as not yet live.
//
// Why this exists (David 2026-07-31): migrations in this repo have historically
// reached production through three disjoint paths — the Supabase CLI, ad hoc
// `pg` scripts, and hand-run SQL in the Studio editor — so `supabase db push`
// cannot be trusted to do the right thing and `schema_migrations` is not an
// honest ledger. The 2026-07-28 audit (supabase/migrations/MIGRATION_LEDGER.md)
// went object-by-object against the live catalog and found four files that are
// still missing. This script applies exactly those four, in the one order that
// is safe, and nothing else.
//
// The ordering is not cosmetic. `20260727_prevent_role_self_escalation.sql`
// installs a trigger whose body calls `public.get_user_role()`, and that
// function is BROKEN live — it raises `column reference "user_id" is ambiguous`
// on every call. Apply the trigger first and every role-changing UPDATE on
// user_profiles starts failing, including David's own admin tooling. So the
// fix migration is a hard prerequisite, enforced in code below, not a comment.
//
// DRY RUN BY DEFAULT. Without --apply this connects, reports what is already
// live, prints the plan, and writes nothing.
//
// Usage:
//   node --env-file=backend/.env scripts/apply-pending-migrations.mjs
//   node --env-file=backend/.env scripts/apply-pending-migrations.mjs --apply
//   node --env-file=backend/.env scripts/apply-pending-migrations.mjs --apply --only=fix-get-user-role
//   node --env-file=backend/.env scripts/apply-pending-migrations.mjs --apply --track
//
// Flags:
//   --apply         actually write (default is dry run)
//   --only=<id>     restrict to one migration; prerequisites are still enforced
//   --track         also record the version in supabase_migrations.schema_migrations
//                   so a future `supabase db push` stops trying to re-apply it
//
// Env: DATABASE_URL (backend/.env has it). Everything runs as that role.
// ---------------------------------------------------------------------------
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const APPLY = process.argv.includes('--apply')
const TRACK = process.argv.includes('--track')
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1] || null

// ---------------------------------------------------------------------------
// The plan. Order in this array IS the apply order.
//
// `check` must be read-only and must never throw for a reason other than "the
// database said no" — a check that blows up is reported as UNKNOWN and blocks
// the apply rather than guessing.
// ---------------------------------------------------------------------------
const PLAN = [
  {
    id: 'fix-get-user-role',
    file: 'supabase/migrations/20260728_fix_get_user_role_ambiguity.sql',
    title: 'Fix the ambiguous column reference in get_user_role()',
    why: 'Every call raises "column reference user_id is ambiguous", so ~15 RLS policies fail closed. Highest priority in the ledger.',
    requires: [],
    check: async (c) => {
      try {
        await c.query('SELECT public.get_user_role($1::uuid)', ['00000000-0000-0000-0000-000000000000'])
        return { applied: true, detail: 'get_user_role() returns without error' }
      } catch (err) {
        if (err.code === '42702') return { applied: false, detail: 'get_user_role() raises 42702 ambiguous_column (the bug)' }
        if (err.code === '42883') return { applied: false, detail: 'get_user_role() does not exist yet' }
        throw err
      }
    }
  },
  {
    id: 'prevent-role-escalation',
    file: 'supabase/migrations/20260727_prevent_role_self_escalation.sql',
    title: 'Make user_profiles.role immutable for non-privileged callers',
    why: 'Closes the self-promotion hole: "Users can update their own profile" has no WITH CHECK on role, so any user could set role = admin.',
    requires: ['fix-get-user-role'],
    check: async (c) => {
      const { rows } = await c.query(
        `SELECT 1 FROM pg_trigger WHERE tgname = 'enforce_user_profile_role_immutable_trigger' AND NOT tgisinternal`
      )
      return { applied: rows.length > 0, detail: rows.length ? 'trigger present' : 'trigger absent' }
    }
  },
  {
    id: 'orders-staff-write',
    file: 'supabase/migrations/20260728120000_orders_staff_write_access.sql',
    title: 'Give admin/founder full order access and managers order UPDATE',
    why: 'OrderManagement.tsx opens the page to admin/manager/founder, but orders RLS only ever had a SELECT-own policy, so their writes silently failed.',
    requires: ['fix-get-user-role'],
    check: async (c) => {
      const { rows } = await c.query(
        `SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'orders'`
      )
      const names = rows.map(r => r.policyname)
      const want = ['Admins have full access to all orders', 'Managers can update orders']
      const missing = want.filter(w => !names.includes(w))
      return {
        applied: missing.length === 0,
        detail: missing.length ? `missing policy: ${missing.join(', ')}` : 'both policies present'
      }
    }
  },
  {
    id: 'landing-page-suggestions',
    file: 'supabase/migrations/20260728090000_landing_page_suggestions.sql',
    title: 'Create landing_page_suggestions (Trend Scout → Watchtower bridge)',
    why: 'Trend Scout writes here; the table was never created in prod, so that path errors today.',
    requires: [],
    check: async (c) => {
      const { rows } = await c.query(`SELECT to_regclass('public.landing_page_suggestions') AS t`)
      return { applied: !!rows[0]?.t, detail: rows[0]?.t ? 'table present' : 'table absent' }
    }
  },
  {
    id: 'anon-policy-lockdown',
    file: 'supabase/migrations/20260805_security_lockdown.sql',
    title: 'Remove wide-open "public USING(true)" policies exposing tables to the anon key',
    why: 'Anon key could read/write support_tickets (the bot-spam vector, bypassing the backend rate limit) and read gift_cards/discount_codes/admin_notifications. Frontend never uses the anon client on these; backend access is service-role and bypasses RLS.',
    requires: [],
    check: async (c) => {
      const { rows } = await c.query(
        `SELECT count(*)::int AS n
           FROM pg_policies
          WHERE schemaname = 'public'
            AND policyname IN (
              'Service role full access to support tickets',
              'Service role full access to ticket messages',
              'Service role full access to admin notifications',
              'System can insert notifications',
              'Service role full access to gift cards',
              'Service role full access to discount codes',
              'Service role full access to coupon usage',
              'Service role full access to chat sessions',
              'Service role full access to agent status'
            )`
      )
      const n = rows[0].n
      return { applied: n === 0, detail: n === 0 ? 'wide-open policies removed' : `${n} wide-open policies still present` }
    }
  },
  {
    id: 'discount-codes-lockdown',
    file: 'supabase/migrations/20260805_02_discount_codes_lockdown.sql',
    title: 'Remove the "Anyone can read active discount codes" public policy',
    why: 'A second permissive policy let the anon key enumerate every active coupon code. Coupon validation is server-side; the frontend never reads this table via the anon client.',
    requires: [],
    check: async (c) => {
      const { rows } = await c.query(
        `SELECT count(*)::int AS n FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'discount_codes'
            AND policyname = 'Anyone can read active discount codes'`
      )
      return { applied: rows[0].n === 0, detail: rows[0].n === 0 ? 'coupon-code leak closed' : 'public read policy still present' }
    }
  },
  {
    id: 'security-round2',
    file: 'supabase/migrations/20260806_security_round2.sql',
    title: 'Block spam-signature tickets + add safe public_profiles view (both safe/additive)',
    why: 'Spam bot hits the public contact-form endpoint below the rate limit; a trigger rejects the gibberish mixed-case no-space subject signature. Also adds the public_profiles view the frontend reads. Neither breaks anything.',
    requires: [],
    check: async (c) => {
      const trig = await c.query(
        `SELECT 1 FROM pg_trigger WHERE tgname = 'reject_spam_support_ticket' AND NOT tgisinternal`
      )
      const view = await c.query(`SELECT to_regclass('public.public_profiles') AS v`)
      const ok = trig.rows.length > 0 && !!view.rows[0].v
      const missing = []
      if (!trig.rows.length) missing.push('spam trigger absent')
      if (!view.rows[0].v) missing.push('public_profiles view absent')
      return { applied: ok, detail: ok ? 'spam trigger + safe profile view live' : missing.join(', ') }
    }
  },
  {
    id: 'drop-vendor-product-shim-columns',
    file: 'supabase/migrations/20260817020000_drop_obsolete_vendor_product_columns.sql',
    title: 'Drop the obsolete name/metadata legacy-compat shim columns from vendor_products',
    why: 'Added 2026-08-17 only so the old /download route select would not 42703; that route has since been repointed to products (or, even where unrepointed, vendor_products has 0 rows / no writer so the columns are unread in practice). No remaining reader or writer in backend/ or src/.',
    requires: [],
    check: async (c) => {
      const { rows } = await c.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'vendor_products'
            AND column_name IN ('name', 'metadata')`
      )
      const present = rows.map(r => r.column_name)
      return { applied: present.length === 0, detail: present.length ? `still present: ${present.join(', ')}` : 'name/metadata columns absent' }
    }
  },
  {
    id: 'profiles-cut-anon',
    file: 'supabase/migrations/20260806_03_profiles_cut_anon.sql',
    title: 'Revoke anon read of user_profiles (closes PII leak) — APPLY ONLY AFTER repointed frontend is live',
    why: 'Revokes the anon key\'s table-level SELECT on user_profiles (email/address/tax_id). Anon reads public data via the public_profiles view instead — but ONLY once the repointed frontend has deployed. The RLS policy is kept so authenticated cross-user reads (messaging, etc.) keep working.',
    requires: ['security-round2'],
    check: async (c) => {
      const { rows } = await c.query(
        `SELECT count(*)::int AS n FROM information_schema.role_table_grants
          WHERE table_schema='public' AND table_name='user_profiles'
            AND grantee='anon' AND privilege_type='SELECT'`
      )
      return { applied: rows[0].n === 0, detail: rows[0].n === 0 ? 'anon table read revoked' : 'anon still has SELECT grant' }
    }
  }
]

const C = { dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', bold: '\x1b[1m', off: '\x1b[0m' }
const say = (m = '') => console.log(m)
const ok = (m) => say(`${C.green}✓${C.off} ${m}`)
const warn = (m) => say(`${C.yellow}!${C.off} ${m}`)
const bad = (m) => say(`${C.red}✗${C.off} ${m}`)

/** Version string the Supabase CLI would use, derived from the filename prefix. */
const versionOf = (file) => (file.split('/').pop().match(/^(\d+)/) || [])[1] || null

function readMigration(file) {
  const path = join(REPO, file)
  if (!existsSync(path)) throw new Error(`migration file not found: ${file}`)
  const sql = readFileSync(path, 'utf8').trim()
  if (!sql) throw new Error(`migration file is empty: ${file}`)
  return sql
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) {
    bad('DATABASE_URL is not set. Run with:  node --env-file=backend/.env scripts/apply-pending-migrations.mjs')
    process.exit(1)
  }

  const selected = ONLY ? PLAN.filter(m => m.id === ONLY) : PLAN
  if (ONLY && !selected.length) {
    bad(`--only=${ONLY} matched nothing. Valid ids: ${PLAN.map(m => m.id).join(', ')}`)
    process.exit(1)
  }

  // Fail fast on a typo'd or empty file BEFORE opening a connection.
  for (const m of PLAN) m.sql = readMigration(m.file)

  // The Supabase pooler presents a cert that Node can't chain to a public
  // root, and DATABASE_URL carries ?sslmode=require which makes node-postgres
  // verify it — that overrides the ssl object below and fails with
  // "self-signed certificate in certificate chain". Strip the libpq ssl/pooler
  // query params so TLS is driven purely by the explicit ssl object.
  const cleanUrl = (() => {
    try {
      const u = new URL(url)
      u.searchParams.delete('sslmode')
      u.searchParams.delete('pgbouncer')
      return u.toString()
    } catch {
      return url
    }
  })()

  const client = new pg.Client({ connectionString: cleanUrl, ssl: { rejectUnauthorized: false }, statement_timeout: 60_000 })
  await client.connect()

  const { rows: [who] } = await client.query(
    `SELECT current_database() AS db, current_user AS usr, inet_server_addr()::text AS host`
  )
  say(`${C.bold}Target${C.off}  ${who.db} as ${who.usr}${who.host ? ` @ ${who.host}` : ''}`)
  say(`${C.bold}Mode${C.off}    ${APPLY ? `${C.yellow}APPLY — this writes to the database${C.off}` : `${C.dim}dry run (nothing will be written)${C.off}`}`)
  say()

  // ---- Read-only status pass over the WHOLE plan (prereqs matter even when --only) ----
  const status = new Map()
  for (const m of PLAN) {
    try {
      const r = await m.check(client)
      status.set(m.id, r)
      const tag = r.applied ? `${C.green}LIVE   ${C.off}` : `${C.yellow}PENDING${C.off}`
      say(`  ${tag} ${m.id.padEnd(26)} ${C.dim}${r.detail}${C.off}`)
    } catch (err) {
      status.set(m.id, { applied: null, detail: `check failed: ${err.message}` })
      bad(`  UNKNOWN ${m.id.padEnd(26)} check failed: ${err.message}`)
    }
  }
  say()

  const unknown = [...status.values()].some(s => s.applied === null)
  if (unknown) {
    bad('At least one status check failed. Not applying anything — fix the connection or the check first.')
    await client.end()
    process.exit(1)
  }

  const todo = selected.filter(m => !status.get(m.id).applied)
  if (!todo.length) {
    ok('Nothing to do — every migration in the plan is already live.')
    await client.end()
    return
  }

  say(`${C.bold}Plan${C.off} (${todo.length} to apply, in this order):`)
  for (const [i, m] of todo.entries()) {
    say(`  ${i + 1}. ${C.bold}${m.id}${C.off} — ${m.title}`)
    say(`     ${C.dim}${m.file}${C.off}`)
    say(`     ${C.dim}${m.why}${C.off}`)
  }
  say()

  if (!APPLY) {
    warn('Dry run. Re-run with --apply to execute the plan above.')
    await client.end()
    return
  }

  // ---- Apply, one transaction per migration, stopping at the first failure ----
  const doneThisRun = new Set()
  for (const m of todo) {
    // The ledger's hard rule, enforced rather than documented: a migration whose
    // prerequisite is neither already live nor applied earlier in THIS run does
    // not get to run at all.
    const unmet = m.requires.filter(r => !status.get(r)?.applied && !doneThisRun.has(r))
    if (unmet.length) {
      bad(`${m.id}: prerequisite not satisfied — ${unmet.join(', ')} must be applied first. Stopping.`)
      if (ONLY) warn(`Drop --only=${ONLY} and let the script run the full ordered plan.`)
      await client.end()
      process.exit(1)
    }

    process.stdout.write(`  applying ${m.id} … `)
    try {
      await client.query('BEGIN')
      await client.query(m.sql)

      // Verify INSIDE the transaction so a migration that ran without error but
      // did not produce the object it claims to rolls back instead of shipping.
      const after = await m.check(client)
      if (!after.applied) throw new Error(`applied without error but verification failed: ${after.detail}`)

      if (TRACK) {
        const version = versionOf(m.file)
        const { rows } = await client.query(`SELECT to_regclass('supabase_migrations.schema_migrations') AS t`)
        if (version && rows[0]?.t) {
          await client.query(
            `INSERT INTO supabase_migrations.schema_migrations (version, name)
             VALUES ($1, $2) ON CONFLICT (version) DO NOTHING`,
            [version, m.file.split('/').pop().replace(/\.sql$/, '')]
          )
        }
      }

      await client.query('COMMIT')
      doneThisRun.add(m.id)
      say(`${C.green}done${C.off} ${C.dim}(${after.detail})${C.off}`)
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      say(`${C.red}FAILED${C.off}`)
      bad(`${m.id}: ${err.message}`)
      warn('Rolled back. Nothing after this point was attempted.')
      await client.end()
      process.exit(1)
    }
  }

  say()
  ok(`Applied ${doneThisRun.size} migration(s): ${[...doneThisRun].join(', ')}`)
  say()
  say(`${C.bold}Still on you, per the ledger:${C.off}`)
  say(`  • Reconcile the "APPLIED, untracked" rows so future db push runs stop retrying them:`)
  say(`    ${C.dim}supabase migration repair --status applied <version>${C.off}  (once per version)`)
  say(`  • Two known live gaps this script does NOT touch: public.decrement_itc() is missing`)
  say(`    (backend/routes/wallet.ts 500s on it today) and fix_sync_product_images.sql never ran.`)
  say(`  • Update supabase/migrations/MIGRATION_LEDGER.md so the next reader inherits the truth.`)

  await client.end()
}

main().catch(async (err) => {
  bad(err.message)
  process.exit(1)
})
