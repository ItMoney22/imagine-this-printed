import { describe, it, expect, vi } from 'vitest'
import {
  BLOCKED_REASON,
  creditProvidersForJob,
  dryProviderFor,
  makeOutageAlertSender,
  outageAlertCopy,
  type OutageAlert,
} from './image-credit-outage.js'

// The pause/block/resume state machine itself is exercised end to end through
// the real worker loop in worker/ai-jobs-worker.credit-pause.test.ts. This file
// covers the pure parts and the alert's four channels.

const ALERT: OutageAlert = {
  provider: 'replicate',
  detail: 'replicate black-forest-labs/flux-2-pro 402: {"title":"Insufficient credit"}',
  firstJobId: 'a1b2c3d4-0000-4000-8000-000000000000',
  firstJobType: 'replicate_mockup_v2',
  heldJobs: 11,
  probeMinutes: 5,
}

describe('which jobs wait on which provider', () => {
  it('mockups wait on Replicate, a forced-Flare mockup on OpenAI', () => {
    expect(creditProvidersForJob({ type: 'replicate_mockup_v2', input: { template: 'flat_lay' } })).toEqual(['replicate'])
    expect(creditProvidersForJob({ type: 'replicate_mockup_v2', input: { engine: 'print-true' } })).toEqual(['openai'])
  })

  it('an empty OpenAI wallet does not hold Replicate work', () => {
    const dry = new Set(['openai'] as const)
    expect(dryProviderFor({ type: 'replicate_mockup_v2', input: {} }, dry)).toBeNull()
    expect(dryProviderFor({ type: 'replicate_rembg' }, dry)).toBeNull()
    expect(dryProviderFor({ type: 'replicate_image_v2' }, dry)).toBe('openai')
  })

  it('3D jobs and Mrs. Imagine batches are never held', () => {
    const dry = new Set(['replicate', 'openai'] as const)
    for (const type of ['3d_model_concept', '3d_model_tripo', 'mrs_imagine_batch', 'step_flow_model_shot']) {
      expect(dryProviderFor({ type }, dry)).toBeNull()
    }
  })
})

describe('alert wording', () => {
  it('the held-job reason names no engine and says there is nothing to redo', () => {
    expect(BLOCKED_REASON).not.toMatch(/replicate|openai|flux|gpt|flare|grok|claude/i)
    expect(BLOCKED_REASON).toMatch(/not failed/i)
    expect(BLOCKED_REASON).toMatch(/nothing to redo/i)
  })

  it('counts the job that hit it plus everything held', () => {
    const copy = outageAlertCopy(ALERT)
    expect(copy.bellMessage).toMatch(/^12 image jobs on hold, not failed/)
    expect(copy.subject).toBe('Image queue paused: Replicate is out of credit')
    expect(copy.html).toContain('https://replicate.com/account/billing')
  })

  it('the phone line is plain speech: no links, no codes', () => {
    const { spoken } = outageAlertCopy(ALERT)
    expect(spoken).not.toMatch(/https?:|\/|402|select /i)
    expect(spoken).toMatch(/12 image jobs are on hold/)
  })

  it('escapes the provider text in the email', () => {
    const { html } = outageAlertCopy({ ...ALERT, detail: '<script>x</script>' })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('makeOutageAlertSender', () => {
  function harness(env: Record<string, string | undefined>) {
    const bell: any[] = []
    const db = {
      from(table: string) {
        expect(table).toBe('admin_notifications')
        return { insert: async (row: any) => (bell.push(row), { error: null }) }
      },
    }
    const sendEmail = vi.fn(async () => true)
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 }))
    return { bell, sendEmail, fetchImpl, send: makeOutageAlertSender({ db, sendEmail, fetchImpl, env }) }
  }

  it('sends one of each: admin bell, team email, Becky, Jessica', async () => {
    const h = harness({ PRINT_BRIDGE_TOKEN: 'bridge', WATCHTOWER_INTERNAL_SECRET: 'secret', WATCHTOWER_URL: 'https://dt.example/' })
    const result = await h.send(ALERT)

    expect(result).toEqual({ email: true, bell: true, becky: true, jessica: true, errors: [] })
    expect(h.bell).toEqual([{ type: 'health_alert', title: 'Image queue paused: Replicate is out of credit', message: expect.any(String) }])
    expect(h.sendEmail).toHaveBeenCalledTimes(1)
    expect(h.sendEmail.mock.calls[0][0]).toMatchObject({ to: 'wecare@imaginethisprinted.com', subject: 'Image queue paused: Replicate is out of credit' })

    expect(h.fetchImpl).toHaveBeenCalledTimes(2)
    const [beckyUrl, becky] = h.fetchImpl.mock.calls[0] as any
    expect(beckyUrl).toBe('https://dt.example/api/phone/ops-ping')
    expect(becky.headers.Authorization).toBe('Bearer bridge')
    expect(JSON.parse(becky.body)).toMatchObject({ kind: 'image_credit_outage', provider: 'replicate' })
    const [jessicaUrl, jessica] = h.fetchImpl.mock.calls[1] as any
    expect(jessicaUrl).toBe('https://dt.example/api/notify/household')
    expect(jessica.headers['x-internal-secret']).toBe('secret')
    expect(JSON.parse(jessica.body)).toMatchObject({ to: 'david', urgency: 'urgent', event: 'itp.image_credit_outage' })
  })

  it('a missing secret or a refused ping is reported, never thrown, and never stops the other channels', async () => {
    const h = harness({ WATCHTOWER_INTERNAL_SECRET: 'secret' })
    h.fetchImpl.mockResolvedValueOnce({ ok: false, status: 404 })
    const result = await h.send(ALERT)

    expect(result.bell).toBe(true)
    expect(result.email).toBe(true)
    expect(result.becky).toBe(false)
    expect(result.jessica).toBe(false)
    expect(result.errors).toEqual(['becky: PRINT_BRIDGE_TOKEN not set', 'jessica: 404'])
  })
})
