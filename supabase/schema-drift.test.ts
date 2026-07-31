// Regression guard for Watchtower task 85de5f13-e439-4e2c-b13c-6fa5a3281642
// ("Fix itc_transactions + user_wallets schema drift: reconcile repo with live DB").
//
// All four checked-in schema sources for these two tables previously disagreed
// with the live production database (see
// supabase/migrations/20260727_fix_itc_wallet_schema_drift.sql for the full
// writeup and evidence). This test does NOT talk to a database — it statically
// asserts that the declarative sources stay in the corrected (live-matching)
// shape, so a future edit can't silently reintroduce one of the phantom columns
// or drop a real one.
//
// Sources covered: prisma/schema.prisma, backend/prisma/schema.prisma,
// COMPLETE_DATABASE_SETUP.sql. (supabase/migrations/001_initial_schema.sql is
// deliberately NOT re-asserted here — it's a historical, already-applied
// migration left in its original wrong shape on purpose; the corrective
// migration layers on top of it, matching this repo's existing
// 004_schema_fixes.sql / 005_rls_fixes.sql convention.)

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const PHANTOM_ITC_COLUMNS = [
  'usd_value',
  'usdValue',
  'exchange_rate',
  'exchangeRate',
  'payment_intent_id',
  'paymentIntentId',
  'transaction_hash',
  'transactionHash',
  'reference_id',
  'referenceId',
  'processed_at',
  'processedAt',
  'status',
]

const PHANTOM_WALLET_COLUMNS = ['last_itc_activity', 'lastItcActivity']

// "reason" can't be a plain word-boundary phantom check like the others above —
// this file's own explanatory comments legitimately use the word "reason" in
// prose (e.g. "free-text reference/reason"). Instead, check for the actual
// column-declaration shape ("reason TEXT" / "reason  String") that a real
// phantom column would take.
const REASON_COLUMN_PATTERN = /\breason\s+(TEXT|String)\b/

function extractBlock(source: string, startMarker: string, closeToken: string, file: string): string {
  const start = source.indexOf(startMarker)
  if (start === -1) {
    throw new Error(`Could not find "${startMarker}" in ${file}`)
  }
  const end = source.indexOf(closeToken, start)
  if (end === -1) {
    throw new Error(`Could not find "${closeToken}" after "${startMarker}" in ${file}`)
  }
  return source.slice(start, end)
}

function assertNoPhantoms(block: string, phantoms: string[], file: string, table: string) {
  for (const phantom of phantoms) {
    // Word-boundary match so e.g. "reference_id" doesn't false-positive on the
    // unrelated "reference" column.
    const re = new RegExp(`(^|[^a-zA-Z_])${phantom}([^a-zA-Z_]|$)`)
    expect(
      re.test(block),
      `${file}: ${table} block still declares phantom column "${phantom}" — ` +
        `see supabase/migrations/20260727_fix_itc_wallet_schema_drift.sql`
    ).toBe(false)
  }
}

function assertHasRequired(block: string, required: string[], file: string, table: string) {
  for (const col of required) {
    expect(
      block.includes(col),
      `${file}: ${table} block is missing required live column "${col}"`
    ).toBe(true)
  }
}

describe('itc_transactions / user_wallets schema drift guard', () => {
  const sources: Array<{ file: string; itcMarker: string; walletMarker: string; close: string }> = [
    {
      file: 'COMPLETE_DATABASE_SETUP.sql',
      itcMarker: 'CREATE TABLE public.itc_transactions (',
      walletMarker: 'CREATE TABLE public.user_wallets (',
      close: '\n);',
    },
    {
      file: 'prisma/schema.prisma',
      itcMarker: 'model ItcTransaction {',
      walletMarker: 'model UserWallet {',
      close: '\n}',
    },
    {
      file: 'backend/prisma/schema.prisma',
      itcMarker: 'model ItcTransaction {',
      walletMarker: 'model UserWallet {',
      close: '\n}',
    },
  ]

  for (const { file, itcMarker, walletMarker, close } of sources) {
    it(`${file}: itc_transactions matches the verified live shape`, () => {
      const source = fs.readFileSync(path.join(ROOT, file), 'utf8')
      const block = extractBlock(source, itcMarker, close, file)
      assertNoPhantoms(block, PHANTOM_ITC_COLUMNS, file, 'itc_transactions')
      expect(
        REASON_COLUMN_PATTERN.test(block),
        `${file}: itc_transactions block still declares a "reason" column — ` +
          `see supabase/migrations/20260727_fix_itc_wallet_schema_drift.sql`
      ).toBe(false)
      assertHasRequired(
        block,
        ['user_id', 'type', 'amount', 'balance_after', 'reference', 'metadata', 'created_at'],
        file,
        'itc_transactions'
      )
    })

    it(`${file}: user_wallets matches the verified live shape`, () => {
      const source = fs.readFileSync(path.join(ROOT, file), 'utf8')
      const block = extractBlock(source, walletMarker, close, file)
      assertNoPhantoms(block, PHANTOM_WALLET_COLUMNS, file, 'user_wallets')
      assertHasRequired(block, ['updated_at'], file, 'user_wallets')
    })
  }
})
