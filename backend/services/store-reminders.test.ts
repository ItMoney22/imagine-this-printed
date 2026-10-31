import { describe, it, expect } from 'vitest'

// The clock math behind a seller's reminders: Eastern wall time, daylight saving, the grace window and armed_at.
// store-reminders.ts imports lib/supabase.ts, which builds a client at load, so it needs dummy values first.
process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const { easternToUtc, latestSlot, dueSlot, scheduleLabel, timeLabel, reminderHtml, reminderAsk, reminderSubject } = await import('./store-reminders.js')

const MWF = [1, 3, 5]
const HOUR = 60 * 60 * 1000

describe('Eastern time', () => {
  it('turns Eastern wall time into the right instant on both sides of daylight saving', () => {
    expect(easternToUtc(2026, 10, 26, 10, 0).toISOString()).toBe('2026-10-26T14:00:00.000Z') // EDT, UTC-4
    expect(easternToUtc(2026, 11, 1, 10, 0).toISOString()).toBe('2026-11-01T15:00:00.000Z') // clocks went back at 2 AM
    expect(easternToUtc(2026, 3, 8, 9, 0).toISOString()).toBe('2026-03-08T13:00:00.000Z') // clocks went forward at 2 AM
    expect(easternToUtc(2026, 1, 15, 0, 30).toISOString()).toBe('2026-01-15T05:30:00.000Z')
  })

  it('finds the latest Mon/Wed/Fri 10 AM slot', () => {
    // Monday 2026-10-26, a minute before 10 AM Eastern: the last slot was Friday.
    expect(latestSlot(MWF, '10:00', new Date('2026-10-26T13:59:00Z'))?.toISOString()).toBe('2026-10-23T14:00:00.000Z')
    expect(latestSlot(MWF, '10:00', new Date('2026-10-26T14:00:00Z'))?.toISOString()).toBe('2026-10-26T14:00:00.000Z')
    // Tuesday: still Monday's.
    expect(latestSlot(MWF, '10:00:00', new Date('2026-10-27T20:00:00Z'))?.toISOString()).toBe('2026-10-26T14:00:00.000Z')
  })

  it('uses the Eastern calendar day, not the UTC one', () => {
    // 2026-10-27 02:00Z is still Monday 10 PM in New York.
    expect(latestSlot([1], '21:30', new Date('2026-10-27T02:00:00Z'))?.toISOString()).toBe('2026-10-27T01:30:00.000Z')
    expect(latestSlot([2], '21:30', new Date('2026-10-27T02:00:00Z'))?.toISOString()).toBe('2026-10-21T01:30:00.000Z')
  })
})

describe('dueSlot', () => {
  const r = { days: MWF, time_of_day: '10:00', armed_at: '2026-10-20T00:00:00Z', enabled: true }

  it('is due at its time and for the grace window after, then lets the slot go', () => {
    // A minute early, the last slot (Friday) is three days old: long past the grace window.
    expect(dueSlot(r, new Date('2026-10-26T13:59:59Z'), 2 * HOUR)).toBeNull()
    expect(dueSlot(r, new Date('2026-10-26T14:00:00Z'), 2 * HOUR)?.toISOString()).toBe('2026-10-26T14:00:00.000Z')
    expect(dueSlot(r, new Date('2026-10-26T15:59:00Z'), 2 * HOUR)?.toISOString()).toBe('2026-10-26T14:00:00.000Z')
    expect(dueSlot(r, new Date('2026-10-26T16:01:00Z'), 2 * HOUR)).toBeNull()
  })

  it('never sends while switched off, or a slot from before it was switched on', () => {
    expect(dueSlot({ ...r, enabled: false }, new Date('2026-10-26T14:01:00Z'), 2 * HOUR)).toBeNull()
    expect(dueSlot({ ...r, armed_at: '2026-10-26T14:30:00Z' }, new Date('2026-10-26T14:31:00Z'), 2 * HOUR)).toBeNull()
  })
})

describe('labels', () => {
  it('reads like the mock', () => {
    expect(scheduleLabel([1, 3, 5], '10:00')).toBe('Mon, Wed, Fri at 10 AM')
    expect(scheduleLabel([0, 1, 2, 3, 4, 5, 6], '09:00:00')).toBe('Every day at 9 AM')
    expect(scheduleLabel([0], '10:00')).toBe('Sundays at 10 AM')
    expect(scheduleLabel([1, 2, 3, 4, 5], '17:30')).toBe('Weekdays at 5:30 PM')
    expect(scheduleLabel([6, 0], '12:00')).toBe('Weekends at 12 PM')
    expect(timeLabel('00:15')).toBe('12:15 AM')
  })
})

describe('the email', () => {
  const slot = new Date('2026-10-26T14:00:00Z')

  it('asks her assistant for this reminder with the facts it needs', () => {
    const ask = reminderAsk({ kind: 'orders', title: 'Check new orders', note: null }, { newOrders24h: 2, ordersToShip: 1 }, slot)
    expect(ask).toContain('Monday')
    expect(ask).toContain('2 new paid order(s)')
    expect(ask).toContain('1 order(s) with things she ships')
    expect(reminderAsk({ kind: 'custom', title: 'Restock candles', note: 'fair on Saturday' }, { newOrders24h: 0, ordersToShip: 0 }, slot))
      .toContain('"Restock candles (fair on Saturday)"')
    expect(reminderSubject({ kind: 'orders', title: 'Check new orders' }, slot)).toBe('Your orders check for Monday')
  })

  it('escapes what the assistant wrote and says how to switch it off', () => {
    const html = reminderHtml({ kind: 'instagram', title: 'Post on Instagram', days: MWF, time_of_day: '10:00' }, { storeName: 'Crystal’s Shirts and More', slug: 'crystal' }, 'Hi <b>Crystal</b>!\n\nPost the candle.')
    expect(html).toContain('Hi &lt;b&gt;Crystal&lt;/b&gt;!')
    expect(html).toContain('<p style="margin:0 0 14px;white-space:pre-wrap;">Post the candle.</p>')
    expect(html).toContain('/vendor/store/crystal#products')
    expect(html).toContain('Mon, Wed, Fri at 10 AM, Eastern time')
  })
})
