import { describe, it, expect, vi } from 'vitest'

vi.mock('../lib/api', () => ({ apiFetch: vi.fn() }))

import { referralSystem, toUserReferralStats } from './referral-system'

describe('toUserReferralStats', () => {
  it("maps the API's stats into what the dashboard reads", () => {
    const stats = toUserReferralStats({
      totalReferrals: 2,
      firstOrders: 1,
      totalITCEarned: 50,
      referralCode: { id: 'c1', user_id: 'u1', code: 'REFAB12CD', is_active: true, total_uses: 2, total_earnings: '50', created_at: '2026-10-07T20:00:00Z' },
      recentReferrals: [
        { id: 't2', referral_code_id: 'c1', referrer_id: 'u1', referee_id: 'f1', type: 'purchase', referrer_reward_itc: '50', referee_email: 'f@example.com', status: 'completed', created_at: '2026-10-07T21:00:00Z' },
        { id: 't1', referral_code_id: 'c1', referrer_id: 'u1', referee_id: 'f1', type: 'signup', referrer_reward_itc: '0', referee_email: 'f@example.com', status: 'completed', created_at: '2026-10-07T20:00:00Z' },
      ],
    })
    expect(stats.referralCode).toMatchObject({ code: 'REFAB12CD', totalUses: 2, totalEarnings: 50 })
    expect(stats.totalReferrals).toBe(2)
    expect(stats.firstOrders).toBe(1)
    expect(stats.totalItcEarned).toBe(50)
    expect(stats.transactions.map(t => [t.type, t.referrerReward])).toEqual([['purchase', 50], ['signup', 0]])
  })

  it('an account with no code yet maps to an empty dashboard', () => {
    expect(toUserReferralStats({ totalReferrals: 0, activeCode: null })).toMatchObject({ referralCode: null, transactions: [], totalReferrals: 0 })
  })
})

describe('generateSharingContent', () => {
  it('carries the link and promises the friend no bonus', () => {
    const { messages } = referralSystem.generateSharingContent('REFAB12CD')
    expect(messages.map(m => m.platform)).toEqual(['email', 'twitter', 'facebook', 'whatsapp'])
    for (const m of messages) {
      expect(m.message).toContain('ref=REFAB12CD')
      expect(m.message.toLowerCase()).not.toMatch(/bonus|points/)
    }
  })
})
