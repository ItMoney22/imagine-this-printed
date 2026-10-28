import { describe, it, expect, vi, beforeEach } from 'vitest'

const { create } = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create } }
  },
}))

vi.mock('../lib/supabase.js', () => {
  const template = { template_key: 'order_confirmation', ai_enabled: true, ai_prompt_context: 'Confirm the order warmly.' }
  const chain: any = { select: () => chain, eq: () => chain, single: async () => ({ data: template, error: null }) }
  return { supabase: { from: () => chain } }
})

import { generateAIEmail, aiCopyRestatesMoney } from './emailAI.js'

// What gpt-5.4-nano actually wrote for ITP-MTYGMM4V-UQ5X in the 2026-10-28 live replay (task 395ee408).
const LIVE_AI_OUTPUT = {
  subject: 'Destiny! Your order is confirmed 🖤',
  greeting: 'Hey Destiny! 🎃<br>Alright, creative soul—your order is officially confirmed!',
  mainContent:
    '<p>Order number: <strong>ITP-MTYGMM4V-UQ5X</strong></p>\n\n' +
    '<p>We’ve got <strong>2x Gothic Ghost Face Candle Holder</strong> locked in and ready to be made with care. Between you and me? Those ghostly vibes are going to look seriously striking—like your decor just leveled up.</p>\n\n' +
    '<p>Fun fact: “Ghost” faces have been haunting folks in art and design for ages—so you’re basically giving your space a timeless spooky makeover. And hey, candlelight + gothic drama = <strong>chef’s kiss</strong>.</p>\n\n' +
    "<p><strong>Itemized totals</strong><br><table><tr><td>2x Gothic Ghost Face Candle Holder</td><td style='text-align:right;'>$20.00</td></tr></table></p>\n\n" +
    '<p>Thanks for trusting Imagine This Printed with your spooky-cool idea. We’re on it!</p>',
  closing: 'With spooky-good energy,<br><strong>Mr. Imagine</strong>',
}
const PRICE_BLOCK = "<p><strong>Itemized totals</strong><br><table><tr><td>2x Gothic Ghost Face Candle Holder</td><td style='text-align:right;'>$20.00</td></tr></table></p>\n\n"

// The real order row (orders.subtotal / discount_amount / shipping_amount / tax_amount / total).
const ORDER = {
  templateKey: 'order_confirmation',
  customerName: 'Destiny',
  customerEmail: 'delivered@resend.dev',
  orderNumber: 'ITP-MTYGMM4V-UQ5X',
  orderId: '00000000-0000-4000-8000-000000000001',
  items: [{ name: 'Gothic Ghost Face Candle Holder', quantity: 2, price: 20 }],
  total: 30.42,
  totals: { subtotal: 40, discount: 20, shipping: 7.62, tax: 2.8 },
}

const modelReturns = (out: object) =>
  create.mockResolvedValue({ choices: [{ message: { content: JSON.stringify(out) } }] })

const TABLE_OPEN = '<table style="width: 100%; border-collapse: collapse; margin: 20px 0;">'

/** The rendered email split into the code-built order table and everything else. */
function splitAtCodeTable(html: string) {
  const start = html.indexOf(TABLE_OPEN)
  expect(start).toBeGreaterThan(-1)
  const end = html.indexOf('</table>', start) + '</table>'.length
  return { table: html.slice(start, end), rest: html.slice(0, start) + html.slice(end) }
}

const totalsRows = (table: string) =>
  [...table.matchAll(/<td colspan="2"[^>]*>([^<]+)<\/td><td[^>]*>([^<]+)<\/td>/g)].map(m => [m[1], m[2]])

const LIVE_TOTALS = [
  ['Subtotal', '$40.00'],
  ['Discount', '-$20.00'],
  ['Shipping', '$7.62'],
  ['Tax', '$2.80'],
  ['Total', '$30.42'],
]

beforeEach(() => {
  create.mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('aiCopyRestatesMoney', () => {
  it('flags the live "Itemized totals ... $20.00" block', () => {
    expect(aiCopyRestatesMoney(PRICE_BLOCK)).toBe(true)
    expect(aiCopyRestatesMoney(LIVE_AI_OUTPUT.mainContent)).toBe(true)
  })

  it('flags a dollar figure in any spelling, and a table with no price in it', () => {
    for (const s of ['Your total is $30.42', 'only $ 20', 'just &#36;20', '&#x24;7.62 shipping', '$&nbsp;40', '<table><tr><td>2x</td></tr></table>']) {
      expect(aiCopyRestatesMoney(s)).toBe(true)
    }
  })

  it('leaves clean copy alone', () => {
    expect(aiCopyRestatesMoney(LIVE_AI_OUTPUT.greeting)).toBe(false)
    expect(aiCopyRestatesMoney(LIVE_AI_OUTPUT.closing)).toBe(false)
    expect(aiCopyRestatesMoney(LIVE_AI_OUTPUT.mainContent.replace(PRICE_BLOCK, ''))).toBe(false)
    expect(aiCopyRestatesMoney('Made with $ love, 2x the fun')).toBe(false)
  })
})

describe('generateAIEmail order_confirmation (ITP-MTYGMM4V-UQ5X)', () => {
  it('never lets the AI price block reach the email; the code-built table is the only money', async () => {
    modelReturns(LIVE_AI_OUTPUT)
    const email = await generateAIEmail(ORDER)

    expect(email.aiGenerated).toBe(false)
    expect(email.htmlContent).not.toContain('Itemized totals')
    const { table, rest } = splitAtCodeTable(email.htmlContent)
    expect(rest).not.toMatch(/\$\s?\d/)
    expect(rest).not.toMatch(/<table\b/i)
    expect(email.htmlContent.match(/<table\b/gi)).toHaveLength(1)
    expect(totalsRows(table)).toEqual(LIVE_TOTALS)
    expect(email.subject).not.toMatch(/\$\s?\d/)
    expect(email.textContent).not.toContain('Itemized totals')
  })

  it('keeps the AI copy when it leaves prices out', async () => {
    modelReturns({ ...LIVE_AI_OUTPUT, mainContent: LIVE_AI_OUTPUT.mainContent.replace(PRICE_BLOCK, '') })
    const email = await generateAIEmail(ORDER)

    expect(email.aiGenerated).toBe(true)
    expect(email.subject).toBe(LIVE_AI_OUTPUT.subject)
    expect(email.htmlContent).toContain('chef’s kiss')
    const { table, rest } = splitAtCodeTable(email.htmlContent)
    expect(rest).not.toMatch(/\$\s?\d/)
    expect(totalsRows(table)).toEqual(LIVE_TOTALS)
  })

  it('falls back when the price is in the greeting or closing', async () => {
    modelReturns({ ...LIVE_AI_OUTPUT, mainContent: '<p>Locked in!</p>', greeting: 'Hey Destiny, your $30.42 order is in!' })
    expect((await generateAIEmail(ORDER)).aiGenerated).toBe(false)
    modelReturns({ ...LIVE_AI_OUTPUT, mainContent: '<p>Locked in!</p>', closing: 'Enjoy your $40 of spooky!' })
    expect((await generateAIEmail(ORDER)).aiGenerated).toBe(false)
  })

  it('swaps a subject that carries a price for the standard one', async () => {
    modelReturns({ ...LIVE_AI_OUTPUT, mainContent: '<p>Locked in!</p>', subject: 'Your $30.42 order is confirmed' })
    const email = await generateAIEmail(ORDER)
    expect(email.aiGenerated).toBe(true)
    expect(email.subject).toBe('🎉 Order Confirmed - ITP-MTYGMM4V-UQ5X')
  })

  it('never hands the writer a price for a confirmation', async () => {
    modelReturns(LIVE_AI_OUTPUT)
    await generateAIEmail(ORDER)
    const prompt = create.mock.calls[0][0].messages.map((m: any) => m.content).join('\n')
    expect(prompt).toContain('2x Gothic Ghost Face Candle Holder')
    expect(prompt).not.toMatch(/\$\s?\d/)
  })
})
