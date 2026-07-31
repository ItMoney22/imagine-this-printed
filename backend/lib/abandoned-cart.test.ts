// Tests for abandoned-checkout reminder scheduling (Watchtower task
// cd19d3fb-cce5-437e-946c-8e271167d9b7, recovery half).
//
// abandoned-cart.ts is dependency-free — the whole point of splitting the
// decision out of the query is that "who gets mailed, and when" is testable
// with no database and, critically, no live send.

import { describe, it, expect } from 'vitest'
import {
  FIRST_REMINDER_DELAY_MS,
  MAX_RECOVERY_AGE_MS,
  SECOND_REMINDER_DELAY_MS,
  decideReminderStage,
  type AbandonedCandidate
} from './abandoned-cart.js'

const NOW = new Date('2026-07-28T12:00:00.000Z')

function candidate(overrides: Partial<AbandonedCandidate> = {}): AbandonedCandidate {
  return {
    orderId: 'order-1',
    email: 'buyer@example.com',
    createdAt: new Date(NOW.getTime() - FIRST_REMINDER_DELAY_MS).toISOString(),
    sentStages: [],
    ...overrides
  }
}

describe('decideReminderStage — first reminder', () => {
  it('sends once the first delay has elapsed', () => {
    expect(decideReminderStage(candidate(), NOW)).toEqual({ send: true, stage: 'first' })
  })

  it('stays quiet one minute before the delay elapses', () => {
    const tooSoon = candidate({
      createdAt: new Date(NOW.getTime() - FIRST_REMINDER_DELAY_MS + 60_000).toISOString()
    })
    const decision = decideReminderStage(tooSoon, NOW)
    expect(decision.send).toBe(false)
    if (!decision.send) expect(decision.reason).toContain('too soon')
  })
})

describe('decideReminderStage — second reminder', () => {
  it('sends only after the second delay, and only once the first was sent', () => {
    const old = candidate({
      createdAt: new Date(NOW.getTime() - SECOND_REMINDER_DELAY_MS).toISOString(),
      sentStages: ['first']
    })
    expect(decideReminderStage(old, NOW)).toEqual({ send: true, stage: 'second' })
  })

  it('does not skip straight to the second reminder for an old untouched cart', () => {
    // A cart abandoned two days ago that never got a first nudge (the job was
    // down) gets the FIRST mail, not the second. Otherwise the recovery
    // sequence's opening message is never sent at all.
    const old = candidate({
      createdAt: new Date(NOW.getTime() - SECOND_REMINDER_DELAY_MS * 2).toISOString(),
      sentStages: []
    })
    expect(decideReminderStage(old, NOW)).toEqual({ send: true, stage: 'first' })
  })

  it('waits when the first was sent but the second is not due', () => {
    const decision = decideReminderStage(candidate({ sentStages: ['first'] }), NOW)
    expect(decision.send).toBe(false)
  })
})

describe('decideReminderStage — never mail twice, never mail forever', () => {
  it('stops after both stages', () => {
    const done = candidate({
      createdAt: new Date(NOW.getTime() - SECOND_REMINDER_DELAY_MS).toISOString(),
      sentStages: ['first', 'second']
    })
    const decision = decideReminderStage(done, NOW)
    expect(decision.send).toBe(false)
    if (!decision.send) expect(decision.reason).toContain('already sent')
  })

  it('gives up on a checkout older than the recovery window', () => {
    const ancient = candidate({
      createdAt: new Date(NOW.getTime() - MAX_RECOVERY_AGE_MS - 1000).toISOString()
    })
    const decision = decideReminderStage(ancient, NOW)
    expect(decision.send).toBe(false)
    if (!decision.send) expect(decision.reason).toContain('too long ago')
  })
})

describe('decideReminderStage — bad data never produces a send', () => {
  it('skips a checkout with no captured email', () => {
    expect(decideReminderStage(candidate({ email: null }), NOW).send).toBe(false)
    expect(decideReminderStage(candidate({ email: '   ' }), NOW).send).toBe(false)
  })

  it('skips an unparseable timestamp', () => {
    expect(decideReminderStage(candidate({ createdAt: 'not a date' }), NOW).send).toBe(false)
  })

  it('skips a future-dated order rather than treating clock skew as age', () => {
    const future = candidate({ createdAt: new Date(NOW.getTime() + 60_000).toISOString() })
    expect(decideReminderStage(future, NOW).send).toBe(false)
  })
})
