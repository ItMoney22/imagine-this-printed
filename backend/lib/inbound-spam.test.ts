import { describe, it, expect } from 'vitest'
import { decideInboundFiling, bodyForTriage, INBOUND_SPAM_CONFIDENCE } from './inbound-spam'

const triage = (label: string | null, choice?: string, confidence = 0) =>
  ({ label, jev: choice ? { label: { choice, confidence } } : undefined }) as any

describe('decideInboundFiling', () => {
  it('forwards ordinary mail', () => {
    expect(decideInboundFiling({ triage: triage('customer_issue', 'customer_issue', 0.95), recentFromSender: 0 }))
      .toEqual({ forward: true, archive: false, reason: 'ok' })
  })

  it('files confident spam quietly: archived, not forwarded', () => {
    expect(decideInboundFiling({ triage: triage('spam', 'spam', 0.93), recentFromSender: 0 }))
      .toEqual({ forward: false, archive: true, reason: 'spam' })
  })

  it('still forwards spam Jev is only fairly sure of (between the triage bar and the hiding bar)', () => {
    expect(decideInboundFiling({ triage: triage('spam', 'spam', 0.8), recentFromSender: 0 }).forward).toBe(true)
    expect(decideInboundFiling({ triage: triage('spam', 'spam', INBOUND_SPAM_CONFIDENCE), recentFromSender: 0 }).forward).toBe(false)
  })

  it('forwards when Jev is down or had no opinion', () => {
    expect(decideInboundFiling({ triage: null, recentFromSender: 0 }).forward).toBe(true)
    expect(decideInboundFiling({ triage: triage(null, 'spam', 0.4), recentFromSender: 0 }).forward).toBe(true)
  })

  it('stops buzzing the phone for a sender flooding the inbox, but keeps the mail in view', () => {
    expect(decideInboundFiling({ triage: null, recentFromSender: 4, maxPerSenderHour: 5 }).forward).toBe(true)
    expect(decideInboundFiling({ triage: null, recentFromSender: 5, maxPerSenderHour: 5 }))
      .toEqual({ forward: false, archive: false, reason: 'sender_flood' })
  })
})

describe('bodyForTriage', () => {
  it('prefers text and strips html otherwise', () => {
    expect(bodyForTriage('hello', '<p>x</p>')).toBe('hello')
    expect(bodyForTriage(null, '<style>p{}</style><p>Buy&nbsp;SEO <b>now</b></p>')).toBe('Buy SEO now')
    expect(bodyForTriage(null, null)).toBe('')
  })
})
