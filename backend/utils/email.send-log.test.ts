import { describe, it, expect, vi, beforeEach } from 'vitest'

const recordEmailLog = vi.fn().mockResolvedValue(true)
const sendViaResend = vi.fn()
const getSuppression = vi.fn()

vi.mock('../services/email-log.js', () => ({ recordEmailLog }))
vi.mock('../services/email-resend.js', () => ({ sendViaResend }))
vi.mock('../services/email-suppression.js', () => ({ getSuppression }))
// The AI writer is dynamically imported by email.ts; keep it out so the static fallback path runs.
vi.mock('../services/emailAI.js', () => { throw new Error('AI unavailable') })

async function load(withKey = true) {
  vi.resetModules()
  if (withKey) vi.stubEnv('RESEND_API_KEY', 're_test')
  else vi.stubEnv('RESEND_API_KEY', '')
  return import('./email.js')
}

beforeEach(() => {
  recordEmailLog.mockClear()
  sendViaResend.mockReset()
  getSuppression.mockReset().mockResolvedValue(null)
})

describe('email_logs coverage on the send chokepoint', () => {
  it('static-fallback order confirmation (no AI) writes a sent row with the Resend id', async () => {
    sendViaResend.mockResolvedValue({ id: 'rs_abc' })
    const { sendOrderConfirmationEmail } = await load()
    const ok = await sendOrderConfirmationEmail(
      'buyer@example.com', 'ITP-20261012-0001',
      [{ name: 'Tee', quantity: 1, price: 25 }], 25, 'Pat',
      { orderId: '0b0c8a52-6f4d-4b58-9a5e-3f2f4c1a9e11' }
    )
    expect(ok).toBe(true)
    expect(recordEmailLog).toHaveBeenCalledTimes(1)
    expect(recordEmailLog.mock.calls[0][0]).toMatchObject({
      templateKey: 'order_confirmation',
      recipientEmail: 'buyer@example.com',
      aiUsed: false,
      messageId: 'rs_abc',
      status: 'sent',
      orderId: '0b0c8a52-6f4d-4b58-9a5e-3f2f4c1a9e11'
    })
  })

  it('AI-flagged sends record aiUsed true', async () => {
    sendViaResend.mockResolvedValue({ id: 'rs_ai' })
    const { sendEmailWithTracking } = await load()
    await sendEmailWithTracking({ to: 'a@b.com', subject: 's', htmlContent: '<p>x</p>', templateKey: 'welcome', aiUsed: true })
    expect(recordEmailLog.mock.calls[0][0]).toMatchObject({ templateKey: 'welcome', aiUsed: true, status: 'sent', messageId: 'rs_ai' })
  })

  it('a transport failure records a failed row with the reason', async () => {
    sendViaResend.mockRejectedValue(new Error('Resend 422: bad from'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { sendEmailWithTracking } = await load()
    const r = await sendEmailWithTracking({ to: 'a@b.com', subject: 's', htmlContent: '<p>x</p>', templateKey: 'welcome' })
    expect(r.success).toBe(false)
    expect(recordEmailLog.mock.calls[0][0]).toMatchObject({ status: 'failed', errorMessage: 'Resend 422: bad from' })
  })

  it('a suppressed address records a failed row naming the suppression', async () => {
    getSuppression.mockResolvedValue({ reason: 'hard_bounce' })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { sendEmailWithTracking } = await load()
    const r = await sendEmailWithTracking({ to: 'a@b.com', subject: 's', htmlContent: '<p>x</p>' })
    expect(r.suppressed).toBe(true)
    expect(sendViaResend).not.toHaveBeenCalled()
    expect(recordEmailLog.mock.calls[0][0]).toMatchObject({ status: 'failed', errorMessage: 'suppressed: hard_bounce' })
  })

  it('a missing RESEND_API_KEY records a failed row', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { sendEmailWithTracking } = await load(false)
    await sendEmailWithTracking({ to: 'a@b.com', subject: 's', htmlContent: '<p>x</p>' })
    expect(recordEmailLog.mock.calls[0][0]).toMatchObject({ status: 'failed' })
    expect(recordEmailLog.mock.calls[0][0].errorMessage).toMatch(/RESEND_API_KEY/)
  })
})
