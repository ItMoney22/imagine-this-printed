import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Tests for mockup QA (David 2026-08-09: mockups must be true to the design AND
// must not cover the whole shirt unless specified).
//
// The properties that matter:
//   1. Coverage and fidelity are INDEPENDENT. A faithful reproduction blown up
//      across the whole garment must still fail, or the rule does nothing.
//   2. Coverage is judged against the placement the product was BUILT for. A
//      back-only print is SUPPOSED to be large and an all-over print is
//      supposed to cover everything — failing those would reject correct work.
//   3. A QA outage PASSES the shot. Discarding a paid render because our
//      checker broke is strictly worse than shipping an unchecked one.
//   4. Exactly ONE retry is ever bought, and a shot that fails twice lands
//      FLAGGED rather than discarded.
// ---------------------------------------------------------------------------

const create = vi.fn()
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create } }
  },
}))

process.env.OPENAI_API_KEY ||= 'test-openai-key'

const { checkMockup, verifyWithOneRetry, coverageIsExempt } = await import('./mockup-qa.js')

/** Fake one vision response. */
const reply = (obj: Record<string, unknown>) =>
  create.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(obj) } }] })

/** The prompt text handed to the model on the Nth call. */
const promptText = (call = 0) => create.mock.calls[call][0].messages[1].content[0].text as string

beforeEach(() => {
  create.mockReset()
})

describe('checkMockup', () => {
  it('passes a faithful, correctly-sized print', async () => {
    reply({ matches: true, sizeOk: true, issue: '' })
    expect(await checkMockup('d', 'm', 'front-center')).toEqual({ ok: true })
  })

  it('fails a faithful print that covers the entire shirt', async () => {
    reply({ matches: true, sizeOk: false, issue: 'print spans the full front of the shirt' })
    const r = await checkMockup('d', 'm', 'front-center')
    expect(r).toMatchObject({ ok: false, failed: 'coverage' })
    expect(r?.reason).toContain('spans the full front')
  })

  it('reports fidelity, not coverage, when both are wrong', async () => {
    reply({ matches: false, sizeOk: false, issue: 'text was redrawn' })
    // "we printed the wrong art" is the more actionable message of the two.
    expect((await checkMockup('d', 'm', 'front-center'))?.failed).toBe('fidelity')
  })

  it('tells the model a large BACK print is correct', async () => {
    reply({ matches: true, sizeOk: true })
    await checkMockup('d', 'm', 'back-only')
    expect(promptText()).toContain('do not fail it for being large')
  })

  it('tells the model a pocket print must be small', async () => {
    reply({ matches: true, sizeOk: true })
    await checkMockup('d', 'm', 'left-pocket')
    expect(promptText()).toContain('pocket size')
  })

  it('does not judge size at all for an intentional all-over print', async () => {
    reply({ matches: true, sizeOk: false })
    const r = await checkMockup('d', 'm', 'all-over')
    // sizeOk:false must be ignored — the coverage gate is switched off.
    expect(r).toEqual({ ok: true })
    expect(promptText()).toContain('Do NOT judge the print size')
  })

  it('treats an omitted sizeOk as a pass', async () => {
    reply({ matches: true, issue: '' })
    expect(await checkMockup('d', 'm', 'front-center')).toEqual({ ok: true })
  })

  it('falls back to front-center rules for an unknown placement', async () => {
    reply({ matches: true, sizeOk: true })
    await checkMockup('d', 'm', 'nonsense-placement')
    expect(promptText()).toContain('belongs on the CHEST')
  })

  it('accepts either side of a two-sided (front-back) product', async () => {
    reply({ matches: true, sizeOk: true })
    await checkMockup('d', 'm', 'front-back')
    expect(promptText()).toContain('BOTH sides')
    expect(promptText()).toContain('are both CORRECT')
  })

  it('sharpens the rule with the physical size when one is known', async () => {
    reply({ matches: true, sizeOk: true })
    await checkMockup('d', 'm', 'front-center', 11)
    expect(promptText()).toContain('11-inch-wide print')
    expect(promptText()).toContain('about half')
    expect(promptText()).toContain('dramatically larger')
  })

  it('never bolts the size sentence onto pocket rules — pocket scale is fixed', async () => {
    reply({ matches: true, sizeOk: true })
    await checkMockup('d', 'm', 'left-pocket', 13)
    expect(promptText()).not.toContain('13-inch-wide')
  })

  it('returns null (pass) when the vision call throws', async () => {
    create.mockRejectedValueOnce(new Error('429 rate limited'))
    expect(await checkMockup('d', 'm', 'front-center')).toBeNull()
  })

  it('returns null (pass) on unparseable content', async () => {
    create.mockResolvedValueOnce({ choices: [{ message: { content: 'not json' } }] })
    expect(await checkMockup('d', 'm', 'front-center')).toBeNull()
  })
})

describe('coverageIsExempt', () => {
  it('exempts all-over and full-print placements', () => {
    for (const p of ['all-over', 'all_over-print', 'full-print', 'fullprint']) {
      expect(coverageIsExempt(p)).toBe(true)
    }
  })
  it('does not exempt normal placements', () => {
    for (const p of ['front-center', 'left-pocket', 'back-only', null, undefined]) {
      expect(coverageIsExempt(p as any)).toBe(false)
    }
  })
})

describe('verifyWithOneRetry', () => {
  it('does not re-render when the first shot passes', async () => {
    reply({ matches: true, sizeOk: true })
    const rerender = vi.fn()
    const out = await verifyWithOneRetry('d', 'first', 'front-center', rerender)
    expect(out).toEqual({ url: 'first', check: { ok: true } })
    expect(rerender).not.toHaveBeenCalled()
  })

  it('buys exactly one retry and keeps it when it passes', async () => {
    reply({ matches: false, sizeOk: true, issue: 'text redrawn' })
    reply({ matches: true, sizeOk: true })
    const rerender = vi.fn().mockResolvedValue('second')
    const out = await verifyWithOneRetry('d', 'first', 'front-center', rerender)
    expect(rerender).toHaveBeenCalledTimes(1)
    expect(rerender).toHaveBeenCalledWith('text redrawn')
    expect(out).toEqual({ url: 'second', check: { ok: true, retried: true } })
  })

  it('flags rather than discards when the retry also fails', async () => {
    reply({ matches: true, sizeOk: false, issue: 'covers the whole shirt' })
    reply({ matches: true, sizeOk: false, issue: 'still covers the whole shirt' })
    const rerender = vi.fn().mockResolvedValue('second')
    const out = await verifyWithOneRetry('d', 'first', 'front-center', rerender)
    expect(out.url).toBe('second')
    expect(out.check).toMatchObject({ ok: false, failed: 'coverage', retried: true })
    // Never more than one retry, however bad it is.
    expect(rerender).toHaveBeenCalledTimes(1)
  })

  it('keeps the original, flagged, when the re-render itself fails', async () => {
    reply({ matches: false, sizeOk: true, issue: 'wrong colors' })
    const out = await verifyWithOneRetry('d', 'first', 'front-center', async () => null)
    expect(out.url).toBe('first')
    expect(out.check).toMatchObject({ ok: false, failed: 'fidelity', retried: true })
  })

  it('passes the shot through untouched when QA is unavailable', async () => {
    create.mockRejectedValueOnce(new Error('no key'))
    const rerender = vi.fn()
    const out = await verifyWithOneRetry('d', 'first', 'front-center', rerender)
    expect(out).toEqual({ url: 'first', check: { ok: true } })
    expect(rerender).not.toHaveBeenCalled()
  })

  it('carries the physical size into both the first check and the re-check', async () => {
    reply({ matches: true, sizeOk: false, issue: 'too big' })
    reply({ matches: true, sizeOk: true })
    await verifyWithOneRetry('d', 'first', 'front-center', async () => 'second', 'mockup', 13)
    expect(promptText(0)).toContain('13-inch-wide print')
    expect(promptText(1)).toContain('13-inch-wide print')
  })
})
