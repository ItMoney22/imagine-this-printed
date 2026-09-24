import { describe, it, expect } from 'vitest'
import { parseTeamTemplate, sanitizeValues } from '../../shared/team-template.js'
import { buildLetteringPrompt } from './lettering-prompt.js'
import { buildAutoTemplate, DEFAULT_NAME_BOX, normalizeDetection } from './auto-setup.js'

const canvas = { w: 3600, h: 4498, dpi: 300 }

describe('normalizeDetection', () => {
  it('keeps a clean BEAR 9 answer and pads the boxes a little', () => {
    const d = normalizeDetection({
      name: { text: 'Bear', box: { x: 0.1, y: 0.05, w: 0.8, h: 0.2 }, arched: true },
      number: { text: '9', box: { x: 0.3, y: 0.3, w: 0.4, h: 0.5 } },
    })
    expect(d.name?.text).toBe('BEAR')
    expect(d.number?.text).toBe('9')
    expect(d.name!.box.x).toBeLessThan(0.1)
    expect(d.name!.box.w).toBeGreaterThan(0.8)
  })

  it('reads percent boxes as percent', () => {
    const d = normalizeDetection({ number: { text: '27', box: { x: 30, y: 30, w: 40, h: 50 } } })
    expect(d.number!.box.x).toBeGreaterThan(0.25)
    expect(d.number!.box.x).toBeLessThan(0.3)
  })

  it('falls back to the usual spot for a garbage box, and drops an empty name', () => {
    const d = normalizeDetection({ name: { text: 'SMITH', box: { x: 'a' } }, number: { text: '' } })
    expect(d.name!.box).toEqual(DEFAULT_NAME_BOX)
    expect(d.number).toBeNull()
  })

  it('survives a null answer', () => {
    expect(normalizeDetection(null)).toEqual({ name: null, number: null })
  })
})

describe('buildAutoTemplate', () => {
  const detection = normalizeDetection({
    name: { text: 'BEAR', box: { x: 0.1, y: 0.05, w: 0.8, h: 0.2 }, arched: true },
    number: { text: '9', box: { x: 0.3, y: 0.3, w: 0.4, h: 0.5 } },
  })

  it('produces a template the validator accepts, with the samples recorded', () => {
    const t = buildAutoTemplate({ sourceAssetId: 'asset-1', canvas, detection, colours: { name: { fill: '#7A1F2B', strokes: [] } } })
    const parsed = parseTeamTemplate(t)
    expect(parsed).not.toBeNull()
    expect(parsed!.fields.map((f) => [f.key, f.sample])).toEqual([
      ['name', 'BEAR'],
      ['number', '9'],
    ])
    expect(parsed!.fields[0].fill).toBe('#7A1F2B')
    expect(parsed!.upcharge).toBe(0)
  })

  it('still builds with no detection at all (vision down)', () => {
    expect(parseTeamTemplate(buildAutoTemplate({ sourceAssetId: 'a', canvas, detection: null, colours: {} }))).not.toBeNull()
  })

  it('keeps an existing upcharge on re-run', () => {
    expect(buildAutoTemplate({ sourceAssetId: 'a', canvas, detection, colours: {}, upcharge: 5 }).upcharge).toBe(5)
  })

  it("puts the customer's own name in the prompt — FLARE, not a test name", () => {
    const t = parseTeamTemplate(buildAutoTemplate({ sourceAssetId: 'a', canvas, detection, colours: {} }))!
    const prompt = buildLetteringPrompt(t, sanitizeValues(t, { name: 'flare', number: '9' }), 'replace')
    expect(prompt).toContain('currently reads "BEAR", must now read exactly "FLARE"')
    expect(prompt).not.toMatch(/RODRIGUEZ|O'BRIEN|\bLI\b/)
  })

  it('number-only placement removes the name cleanly', () => {
    const t = parseTeamTemplate(buildAutoTemplate({ sourceAssetId: 'a', canvas, detection, colours: {} }))!
    const prompt = buildLetteringPrompt(t, sanitizeValues(t, { name: '', number: '23' }), 'replace')
    expect(prompt).toMatch(/REMOVE it completely/)
    expect(prompt).toContain('must now read exactly "23"')
  })
})
