import { describe, it, expect, vi, beforeEach } from 'vitest'

const insert = vi.fn()
vi.mock('../lib/supabase.js', () => ({
  supabase: { from: vi.fn(() => ({ insert })) }
}))

import { recordEmailLog } from './email-log.js'

beforeEach(() => {
  insert.mockReset()
  vi.restoreAllMocks()
})

describe('recordEmailLog', () => {
  it('writes the row the live email_logs table accepts', async () => {
    insert.mockResolvedValue({ error: null })
    const ok = await recordEmailLog({
      templateKey: 'welcome',
      recipientEmail: 'a@b.com',
      subject: 'Hi',
      aiUsed: true,
      messageId: 'rs_123',
      status: 'sent',
      orderId: '0b0c8a52-6f4d-4b58-9a5e-3f2f4c1a9e11',
      metadata: { total: 10 }
    })
    expect(ok).toBe(true)
    expect(insert).toHaveBeenCalledWith({
      template_key: 'welcome',
      recipient_email: 'a@b.com',
      subject_sent: 'Hi',
      ai_personalization_used: true,
      message_id: 'rs_123',
      status: 'sent',
      error_message: null,
      order_id: '0b0c8a52-6f4d-4b58-9a5e-3f2f4c1a9e11',
      metadata: { total: 10 }
    })
  })

  it('keeps a non-uuid order number out of the uuid column', async () => {
    insert.mockResolvedValue({ error: null })
    await recordEmailLog({ recipientEmail: 'a@b.com', status: 'sent', orderId: 'ITP-20261012-0001' })
    const row = insert.mock.calls[0][0]
    expect(row.order_id).toBeNull()
    expect(row.metadata.order_ref).toBe('ITP-20261012-0001')
    expect(row.template_key).toBe('unclassified')
  })

  it('logs a descriptive error (and returns false) when supabase resolves { error }', async () => {
    insert.mockResolvedValue({ error: { message: 'column "x" does not exist', code: '42703', details: null, hint: null } })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ok = await recordEmailLog({ templateKey: 'order_confirmation', recipientEmail: 'a@b.com', status: 'sent' })
    expect(ok).toBe(false)
    const msg = spy.mock.calls[0].join(' ')
    expect(msg).toContain('order_confirmation')
    expect(msg).toContain('a@b.com')
    expect(msg).toContain('column "x" does not exist')
    expect(msg).toContain('42703')
  })

  it('never throws when the client itself throws', async () => {
    insert.mockRejectedValue(new Error('network down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(recordEmailLog({ recipientEmail: 'a@b.com', status: 'failed' })).resolves.toBe(false)
  })
})
