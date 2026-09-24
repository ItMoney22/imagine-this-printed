import { describe, it, expect } from 'vitest'
import type { TeamTemplate } from '../../shared/team-template.js'
import { buildLetteringPrompt, spellOut } from './lettering-prompt.js'

const template: TeamTemplate = {
  version: 1,
  side: 'back_image',
  plateAssetId: 'plate',
  sourceAssetId: 'source',
  distressAssetId: null,
  canvas: { w: 3600, h: 4800, dpi: 300 },
  halftone: false,
  upcharge: 0,
  styleNotes: '',
  fields: [
    {
      key: 'name', label: 'Last name', type: 'text', max: 12, uppercase: true,
      zone: { x: 360, y: 480, w: 2880, h: 600 }, arch: 16,
      font: { family: 'collegiate-slab', src: 'house' },
      fill: '#8C1D2D', strokes: [{ color: '#F2E0BC', w: 12 }], offset: null,
    },
    {
      key: 'number', label: 'Number', type: 'number', max: 2, uppercase: false,
      zone: { x: 1200, y: 1440, w: 1200, h: 2000 }, arch: 0,
      font: { family: 'varsity-block', src: 'house' },
      fill: '#C9A227', strokes: [], offset: { dx: 10, dy: 10, color: '#000000' },
    },
  ],
}

describe('buildLetteringPrompt', () => {
  it('says what each field reads now, so the model knows which lettering is which', () => {
    const withSamples = {
      ...template,
      fields: [{ ...template.fields[0], sample: 'BEAR' }, { ...template.fields[1], sample: '9' }],
    }
    const p = buildLetteringPrompt(withSamples, { name: 'SMITH', number: '22' }, 'replace')
    expect(p).toContain('The last name, which currently reads "BEAR", must now read exactly "SMITH"')
    expect(p).toContain('The player number, which currently reads "9", must now read exactly "22"')
    // 'add' mode edits the blank plate — there is no sample on it to name.
    expect(buildLetteringPrompt(withSamples, { name: 'SMITH', number: '22' }, 'add')).not.toContain('currently reads')
  })

  it('carries the art director notes only when there are some', () => {
    const noted = buildLetteringPrompt({ ...template, styleNotes: 'keep the gold drop shadow' }, { name: 'LI', number: '5' }, 'replace')
    expect(noted).toContain("Art director's notes: keep the gold drop shadow")
    expect(buildLetteringPrompt(template, { name: 'LI', number: '5' }, 'replace')).not.toContain('Art director')
  })

  it('names each new value exactly and spells it out', () => {
    const p = buildLetteringPrompt(template, { name: 'SMITH', number: '22' }, 'replace')
    expect(p).toContain('"SMITH" (5 characters: S-M-I-T-H)')
    expect(p).toContain('"22" (2 characters: 2-2)')
  })

  it('places each field from its authored zone, as canvas percentages', () => {
    const p = buildLetteringPrompt(template, { name: 'SMITH', number: '22' }, 'replace')
    // name zone centre: x 1800/3600 = 50%, y 780/4800 = 16%, width 2880/3600 = 80%
    expect(p).toContain('centred about 50% across and 16% down the artwork, spanning roughly 80% of its width, arched upward')
    expect(p).toContain('on a straight baseline')
  })

  it('carries the authored colours as a check', () => {
    const p = buildLetteringPrompt(template, { name: 'SMITH', number: '22' }, 'replace')
    expect(p).toContain('fill #8C1D2D, outlined in #F2E0BC')
    expect(p).toContain('hard offset shadow in #000000')
  })

  it('tells the model to hold the artwork and add no other text', () => {
    const p = buildLetteringPrompt(template, { name: 'SMITH', number: '22' }, 'replace')
    expect(p).toMatch(/change NOTHING else/)
    expect(p).toMatch(/Add no other text/)
    expect(p).toMatch(/Keep any transparent background transparent/)
  })

  it('removes a field the customer left blank instead of inventing one', () => {
    const p = buildLetteringPrompt(template, { name: 'SMITH', number: '' }, 'replace')
    expect(p).toContain('The player number: REMOVE it completely')
  })

  it('describes the style when there is no sample to copy (erased-plate fallback)', () => {
    const p = buildLetteringPrompt(template, { name: 'SMITH', number: '22' }, 'add')
    expect(p).toMatch(/left blank/)
    expect(p).toMatch(/heavy athletic collegiate lettering/)
    expect(p).not.toMatch(/SAME style the sample/)
  })

  it('spells a space so a multi-word surname keeps its gap', () => {
    expect(spellOut('DE LA')).toBe('D-E-(space)-L-A')
  })
})
