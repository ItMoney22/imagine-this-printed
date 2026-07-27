// Regression guard for Watchtower task e9034a97-90f2-4759-98f1-b4d235448743
// ("Fix award_order_rewards() RPC silent failure in prod due to schema drift").
//
// Sibling of schema-drift.test.ts. That one guards the TABLE declarations; this
// one guards the STORED PROCEDURE bodies, which are the half that the June 2026
// application-level fix (commit 6299315) could never have touched.
//
// The failure mode being locked out: award_order_rewards() and
// process_referral_reward() INSERT into points_transactions / itc_transactions.
// If either body names a column that does not exist live, the INSERT raises,
// the function's catch-all handler converts it into a bland
// {success:false} JSON payload, and the caller logs it and moves on -- a reward
// outage with no stack trace and no ledger row. That is exactly how the
// original incident stayed invisible.
//
// This test does NOT talk to a database. It statically parses the SQL and
// asserts the INSERT column lists are a subset of the verified live shapes.
//
// LIVE SHAPES (queried directly 2026-07-27 against project czzyrmizvjqlifcivrhn
// via information_schema.columns -- see the header of
// supabase/migrations/20260727_fix_award_order_rewards.sql for the full writeup):
//   itc_transactions    (id, user_id, type, amount, reference, balance_after,
//                        metadata, created_at)
//   points_transactions (id, user_id, points_change, reason, reference,
//                        balance_after, metadata, created_at)
//   user_wallets        (id, user_id, points, itc_balance, created_at,
//                        updated_at, usd_balance, total_earned, total_spent)

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const CORRECTIVE_MIGRATION = 'supabase/migrations/20260727_fix_award_order_rewards.sql'
const SUPERSEDED_MIGRATION = 'migrations/006_reward_system.sql'

const LIVE_COLUMNS: Record<string, string[]> = {
  itc_transactions: [
    'id', 'user_id', 'type', 'amount', 'reference', 'balance_after', 'metadata', 'created_at',
  ],
  points_transactions: [
    'id', 'user_id', 'points_change', 'reason', 'reference', 'balance_after', 'metadata', 'created_at',
  ],
  user_wallets: [
    'id', 'user_id', 'points', 'itc_balance', 'created_at', 'updated_at',
    'usd_balance', 'total_earned', 'total_spent',
  ],
}

// The specific ghosts that caused this incident. Named explicitly so a failure
// message points at the actual history rather than a generic "unknown column".
const KNOWN_PHANTOMS: Record<string, string[]> = {
  itc_transactions: ['usd_value', 'reason', 'related_entity_type', 'related_entity_id',
                     'exchange_rate', 'payment_intent_id', 'transaction_hash',
                     'reference_id', 'status', 'processed_at', 'created_by'],
  points_transactions: ['type', 'amount', 'related_entity_type', 'related_entity_id', 'created_by'],
  user_wallets: ['points_balance', 'last_itc_activity'],
}

function read(file: string): string {
  return fs.readFileSync(path.join(ROOT, file), 'utf8')
}

/** Strip `--` line comments so prose about phantom columns can't trip the parser. */
function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '')
}

/** Extract each `CREATE [OR REPLACE] FUNCTION name(...) ... AS $$ ... $$;` body. */
function extractFunctionBody(sql: string, fnName: string): string {
  const re = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+${fnName}\\s*\\(`, 'i')
  const m = re.exec(sql)
  if (!m) throw new Error(`Could not find CREATE FUNCTION ${fnName}`)
  const from = sql.slice(m.index)
  const open = from.indexOf('$$')
  if (open === -1) throw new Error(`Could not find opening $$ for ${fnName}`)
  const close = from.indexOf('$$', open + 2)
  if (close === -1) throw new Error(`Could not find closing $$ for ${fnName}`)
  return from.slice(open + 2, close)
}

/**
 * Pull the column list out of every `INSERT INTO <table> ( ... )` in a body.
 * Returns one string[] of column names per INSERT statement found.
 */
function insertColumnLists(body: string, table: string): string[][] {
  const re = new RegExp(`INSERT\\s+INTO\\s+${table}\\s*\\(([^)]*)\\)`, 'gi')
  const lists: string[][] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    lists.push(
      m[1]
        .split(',')
        .map(c => c.trim())
        .filter(Boolean)
    )
  }
  return lists
}

const FUNCTIONS = ['award_order_rewards', 'process_referral_reward'] as const
const LEDGER_TABLES = ['points_transactions', 'itc_transactions'] as const

describe('reward RPC bodies match the verified live column shapes', () => {
  const sql = stripComments(read(CORRECTIVE_MIGRATION))

  for (const fn of FUNCTIONS) {
    describe(fn, () => {
      const body = extractFunctionBody(sql, fn)

      for (const table of LEDGER_TABLES) {
        it(`only INSERTs live columns into ${table}`, () => {
          const lists = insertColumnLists(body, table)
          expect(
            lists.length,
            `${fn} has no INSERT INTO ${table} — did the statement get renamed or dropped? ` +
              `If that is intentional, update this guard.`
          ).toBeGreaterThan(0)

          for (const cols of lists) {
            for (const col of cols) {
              const phantom = KNOWN_PHANTOMS[table].includes(col)
              expect(
                LIVE_COLUMNS[table].includes(col),
                phantom
                  ? `${fn}: INSERT INTO ${table} names "${col}", which does NOT exist on the ` +
                    `live table. This is the exact column that caused the silent reward ` +
                    `outage — see ${CORRECTIVE_MIGRATION}. Put it inside metadata instead.`
                  : `${fn}: INSERT INTO ${table} names unknown column "${col}". Live shape is ` +
                    `(${LIVE_COLUMNS[table].join(', ')}). If the live table really gained a ` +
                    `column, add it to LIVE_COLUMNS here in the same commit.`
              ).toBe(true)
            }
          }
        })
      }

      it('does not read or write a phantom user_wallets column', () => {
        for (const phantom of KNOWN_PHANTOMS.user_wallets) {
          const re = new RegExp(`(^|[^a-zA-Z_])${phantom}([^a-zA-Z_]|$)`)
          expect(
            re.test(body),
            `${fn} references user_wallets.${phantom}, which does not exist live. ` +
              `Live user_wallets uses "points" (not points_balance) and "updated_at" ` +
              `(not last_itc_activity).`
          ).toBe(false)
        }
      })

      it('writes balance_after from a row it locked FOR UPDATE', () => {
        // balance_after is a read-modify-write. Without a row lock, two
        // concurrent awards compute it from the same stale read and the ledger
        // permanently disagrees with the wallet.
        expect(
          /FOR\s+UPDATE/i.test(body),
          `${fn} computes balance_after but never locks the user_wallets row ` +
            `(SELECT ... FOR UPDATE). Concurrent awards would diverge the ledger ` +
            `from the wallet.`
        ).toBe(true)
      })
    })
  }
})

describe('the broken reward migration stays quarantined', () => {
  it('006_reward_system.sql is still marked SUPERSEDED -- DO NOT APPLY', () => {
    const raw = read(SUPERSEDED_MIGRATION)
    expect(
      raw.includes('SUPERSEDED -- DO NOT APPLY'),
      `${SUPERSEDED_MIGRATION} lost its quarantine banner. That file was never applied to ` +
        `production and still contains CREATE OR REPLACE FUNCTION bodies that INSERT into ` +
        `nonexistent columns — applying it would silently break every order reward again. ` +
        `Restore the banner, or delete the file outright.`
    ).toBe(true)
  })

  it('is the only reward-function definition outside the corrective migration', () => {
    // Any NEW migration that defines these functions must be reviewed against
    // the live shapes; this catches a third file quietly appearing.
    const dirs = ['migrations', 'supabase/migrations']
    const definers: string[] = []
    for (const dir of dirs) {
      const abs = path.join(ROOT, dir)
      if (!fs.existsSync(abs)) continue
      for (const f of fs.readdirSync(abs)) {
        if (!f.endsWith('.sql')) continue
        const rel = `${dir}/${f}`
        const raw = fs.readFileSync(path.join(abs, f), 'utf8')
        if (/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(award_order_rewards|process_referral_reward)/i.test(raw)) {
          definers.push(rel)
        }
      }
    }
    expect(
      definers.sort(),
      `Unexpected file(s) defining the reward RPCs. Only the corrective migration and the ` +
        `quarantined 006 should. A new definer must be checked against the live column ` +
        `shapes and then added here.`
    ).toEqual([SUPERSEDED_MIGRATION, CORRECTIVE_MIGRATION].sort())
  })
})
