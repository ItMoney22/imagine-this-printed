// Tests for the automatic signup-bot sweep. It deletes accounts on its own, so
// the properties under test are the ways it could delete a real customer:
//   1. judging anyone who has signed in, owns an order, or isn't a customer,
//   2. deleting on a fingerprint when Jev is sure the account is a person,
//   3. deleting on a weak Jev answer with no fingerprint behind it,
//   4. deleting anything in shadow mode, or past the per-tick cap.
// Fixture names copy the shape of the September bots; every address is made up.

import { describe, it, expect } from 'vitest'

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const { sweepSignupBots, decideAccount, accountState, botSweepMode, BOT_SWEEP_MAX_DELETES } = await import('./signup-bot-sweep.js')
type Deps = Parameters<typeof sweepSignupBots>[0]
type Account = Awaited<ReturnType<Deps['listSignupsSince']>>[number]

const NOW = new Date('2026-09-24T12:00:00.000Z')
const HOUR = 3600 * 1000

function acct(id: string, email: string, first: string, last: string, extra: Partial<Account> = {}): Account {
  return {
    id,
    email,
    created_at: new Date(NOW.getTime() - 2 * HOUR).toISOString(),
    last_sign_in_at: null,
    email_confirmed_at: null,
    user_metadata: { first_name: first, last_name: last, display_name: first },
    ...extra,
  }
}

type Verdict = { choice: 'bot' | 'real_person' | 'unsure'; confidence: number } | null

function deps(accounts: Account[], verdicts: Record<string, Verdict>, over: Partial<Deps> = {}) {
  const deleted: string[] = []
  const audited: string[] = []
  const asked: string[] = []
  const d: Deps = {
    listSignupsSince: async () => accounts,
    idsWithOrders: async () => new Set(),
    rolesFor: async () => new Map(),
    deleteUser: async id => { deleted.push(id); return { ok: true } },
    audit: async u => { audited.push(u.id) },
    askJev: async state => {
      asked.push(String(state.email))
      const v = verdicts[String(state.email)]
      if (!v) return null
      return { answers: { account: { type: 'choice', ...v } }, usage: { input_tokens: 0, output_tokens: 0, cost: 0 } }
    },
    now: () => NOW,
    protectedEmails: new Set(),
    keptIds: new Set(),
    ...over,
  }
  return { d, deleted, audited, asked }
}

const bot = acct('b1', 'pat.lee@example-corp.com', 'Aagkv', 'Oqpwixto')
const dotted = acct('b2', 'j.ds.m.i.th.4@gmail.com', 'Jane', 'Smith')
const person = acct('p1', 'maria.gonzalez@example.com', 'Maria', 'Gonzalez')

describe('decideAccount', () => {
  it('deletes on a confident Jev bot verdict even with no fingerprint (the 3-consonant names the old check missed)', () => {
    expect(decideAccount(bot, { choice: 'bot', confidence: 0.97 }).action).toBe('delete')
  })
  it('keeps a no-fingerprint account when Jev is under its bar', () => {
    expect(decideAccount(bot, { choice: 'bot', confidence: 0.8 }).action).toBe('keep')
  })
  it('keeps a no-fingerprint account when Jev is down', () => {
    expect(decideAccount(bot, undefined).action).toBe('keep')
  })
  it('deletes on a fingerprint when Jev is down', () => {
    expect(decideAccount(dotted, undefined).action).toBe('delete')
  })
  it('lets a confident real_person verdict overrule a fingerprint', () => {
    const d = decideAccount(dotted, { choice: 'real_person', confidence: 0.9 })
    expect(d.action).toBe('keep')
    expect(d.reason).toMatch(/overruled/)
  })
  it('keeps a real-looking person Jev calls real', () => {
    expect(decideAccount(person, { choice: 'real_person', confidence: 0.95 }).action).toBe('keep')
  })
})

describe('accountState', () => {
  it('shows Jev that the name is not in the email, and the email is a company address', () => {
    const s = accountState(bot, NOW)
    expect(s.name_appears_in_email).toBe(false)
    expect(s.email_kind).toMatch(/company/)
    expect(s.minutes_since_signup).toBe(120)
  })
  it('sees the name in a matching address', () => {
    expect(accountState(person, NOW).name_appears_in_email).toBe(true)
  })
})

describe('sweepSignupBots', () => {
  const sure = { choice: 'bot' as const, confidence: 0.97 }

  it('deletes and audits bots, keeps people', async () => {
    const { d, deleted, audited } = deps([bot, person], {
      [bot.email!]: sure,
      [person.email!]: { choice: 'real_person', confidence: 0.96 },
    })
    const s = await sweepSignupBots(d, 'on')
    expect(deleted).toEqual(['b1'])
    expect(audited).toEqual(['b1'])
    expect(s.kept.map(k => k.email)).toEqual([person.email])
  })

  it('never judges an account that has signed in, owns an order, is not a customer, or is protected', async () => {
    const signedIn = acct('s1', 'x@y.com', 'Xqzvk', 'Brrpt', { last_sign_in_at: NOW.toISOString() })
    const buyer = acct('o1', 'o@y.com', 'Xqzvk', 'Brrpt')
    const vendor = acct('v1', 'v@y.com', 'Xqzvk', 'Brrpt')
    const safe = acct('k1', 'Keep@Me.com', 'Xqzvk', 'Brrpt')
    const all = [signedIn, buyer, vendor, safe]
    const { d, deleted, asked } = deps(all, Object.fromEntries(all.map(a => [a.email!, sure])), {
      idsWithOrders: async () => new Set(['o1']),
      rolesFor: async () => new Map([['v1', 'vendor']]),
      protectedEmails: new Set(['keep@me.com']),
    })
    const s = await sweepSignupBots(d, 'on')
    expect(deleted).toEqual([])
    expect(asked).toEqual([])
    expect(s.exempt).toBe(4)
  })

  it('shadow mode decides but deletes nothing', async () => {
    const { d, deleted } = deps([bot], { [bot.email!]: sure })
    const s = await sweepSignupBots(d, 'shadow')
    expect(deleted).toEqual([])
    expect(s.wouldDelete).toHaveLength(1)
  })

  it('off mode does nothing at all', async () => {
    const { d, asked } = deps([bot], { [bot.email!]: sure })
    await sweepSignupBots(d, 'off')
    expect(asked).toEqual([])
  })

  it('stops deleting at the per-tick cap', async () => {
    const wave = Array.from({ length: BOT_SWEEP_MAX_DELETES + 3 }, (_, i) => acct(`w${i}`, `w${i}@corp.com`, 'Aagkv', 'Oqpwixto'))
    const { d, deleted } = deps(wave, Object.fromEntries(wave.map(a => [a.email!, sure])))
    const s = await sweepSignupBots(d, 'on')
    expect(deleted).toHaveLength(BOT_SWEEP_MAX_DELETES)
    expect(s.wouldDelete).toHaveLength(3)
  })

  it('does not re-ask Jev about an account it already kept', async () => {
    const { d, asked } = deps([person], { [person.email!]: { choice: 'real_person', confidence: 0.96 } })
    await sweepSignupBots(d, 'on')
    await sweepSignupBots(d, 'on')
    expect(asked).toEqual([person.email])
  })

  it('reports a delete Postgres refused instead of counting it', async () => {
    const { d } = deps([bot], { [bot.email!]: sure }, { deleteUser: async () => ({ ok: false, reason: 'owns orders or ledger history' }) })
    const s = await sweepSignupBots(d, 'on')
    expect(s.deleted).toEqual([])
    expect(s.failed[0].reason).toMatch(/orders/)
  })
})

describe('botSweepMode', () => {
  it('defaults to on and accepts shadow/off', () => {
    expect(botSweepMode(undefined)).toBe('on')
    expect(botSweepMode('Shadow')).toBe('shadow')
    expect(botSweepMode('off')).toBe('off')
    expect(botSweepMode('garbage')).toBe('on')
  })
})
