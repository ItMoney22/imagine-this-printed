import { describe, it, expect } from 'vitest'
import { checkTicketSpam, isRandomToken } from './spam-guard'

// Shapes copied from the live bot (2026-10-07), not real customer data.
const BOT = [
  { subject: 'IBBemvLcPW', description: 'Ie9G7TNF63cx1poUIZIJbSmRG5R3nDXukB4Xj38vzVI88eCnHQxKvO8', order_id: '0wvd4Ok9Wn' },
  { subject: 'HJTwsaKL5v', description: 'zfd5lzalDCwmelvm7PfwfwrOprA9umlYjePX7H2262kr5BsOVo9CQKE', order_id: 'QF9txwzmEE' },
  { subject: 'R9Y7J8SCIO', description: '9V14nz1YA1F69WUYeC1GHpRIPCZW3l6onNM6q4FbVn2i90mdacTWyOM', order_id: 'I4G2WaJwzf' },
  { subject: 'SLfMl3gNFq', description: 'KZrhK7xPB0IoilO4HL26A1Q0Zuye42XpIJtrGzPYGByptSyBYSZCzqN', order_id: 'jGCU61qAQM' },
]

const PEOPLE = [
  { subject: 'Shirt arrived with the print cracked and peeling', description: 'My hoodie came yesterday and the print on the back is cracked.', order_id: 'ITP-MJGZ72AW-IAKZ' },
  { subject: 'Where is my order?', description: 'Tracking 1Z999AA10123456784 has not moved since Monday.', order_id: '#ITP-MTYGMM4V-UQ5X' },
  { subject: 'McDonald family reunion shirts', description: 'Need 40 shirts by Nov 1, see https://example.com/DesignV2Final.png', order_id: '' },
  { subject: 'Bulk quote', description: 'Hi, can you print 200 tees for our church? Thanks, Mary', order_id: null },
  { subject: 'Order question', description: 'Wrong size sent', order_id: 'c1f0e7d2-5b8a-4c1e-9f3a-2d7b6e4a9c10' },
]

describe('checkTicketSpam', () => {
  it('flags every live bot shape', () => {
    for (const t of BOT) expect(checkTicketSpam(t).spam).toBe(true)
  })

  it('passes real customer messages', () => {
    for (const t of PEOPLE) expect(checkTicketSpam(t)).toEqual(expect.objectContaining({ spam: false }))
  })

  it('treats a filled honeypot as spam on its own', () => {
    expect(checkTicketSpam({ ...PEOPLE[0], website: 'http://seo.example' })).toEqual({ spam: true, reasons: ['honeypot'] })
  })

  it('does not flag one stray random field alone', () => {
    expect(checkTicketSpam({ subject: 'Help', description: 'my code is Ab3dEf9hIj', order_id: 'Xk29PqL0zR' }).spam).toBe(false)
  })
})

describe('isRandomToken', () => {
  it('ignores tracking numbers, SKUs and plain words', () => {
    for (const s of ['1Z999AA10123456784', 'ITPSHIRT2026', 'reunion', 'Halloween']) expect(isRandomToken(s, 8)).toBe(false)
  })
})
