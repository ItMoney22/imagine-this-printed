import { describe, it, expect } from 'vitest'
import { reviewFlags } from './review-flags.js'
import type { TeamTemplate } from '../../shared/team-template.js'

const TEMPLATE: TeamTemplate = {
  version: 1,
  side: 'back_image',
  plateAssetId: 'p',
  sourceAssetId: null,
  distressAssetId: null,
  canvas: { w: 3600, h: 4800, dpi: 300 },
  halftone: false,
  upcharge: 0,
  styleNotes: '',
  fields: [
    {
      key: 'name', label: 'Last name', type: 'text', max: 12, uppercase: true,
      zone: { x: 0, y: 0, w: 3000, h: 600 }, arch: 0,
      font: { family: 'varsity-block', src: 'house' },
      fill: '#000000', strokes: [], offset: null,
    },
    {
      key: 'number', label: 'Number', type: 'number', max: 2, uppercase: false,
      zone: { x: 0, y: 1000, w: 1200, h: 2000 }, arch: 0,
      font: { family: 'varsity-block', src: 'house' },
      fill: '#000000', strokes: [], offset: null,
    },
  ],
}

const flag = (name: string, number = '22') => reviewFlags(TEMPLATE, { name, number })

describe('reviewFlags', () => {
  it('passes ordinary surnames without comment', () => {
    for (const name of ['SMITH', 'LOPEZ', 'VANDERMEULEN', "O'BRIEN", 'MURPHY-LEE']) {
      expect(flag(name)).toEqual([])
    }
  })

  it('does NOT flag real surnames that merely sound rude', () => {
    // The point of the whole module: a child named Dick must not hit an error
    // at the till, and must not be flagged as if he had done something.
    for (const name of ['DICK', 'CUMMINGS', 'GAY', 'WANG', 'HOOKER', 'BUTTS']) {
      expect(flag(name)).toEqual([])
    }
  })

  it('flags an actual slur or obscenity', () => {
    expect(flag('FUCK')).toHaveLength(1)
    expect(flag('FUCK')[0].field).toBe('name')
  })

  it('sees through leetspeak and separators', () => {
    expect(flag('F.U.C.K')).toHaveLength(1)
    expect(flag('SH1T')).toHaveLength(1)
    expect(flag('5H1T')).toHaveLength(1)
  })

  it('flags a whole-value trademark', () => {
    expect(flag('NIKE')).toHaveLength(1)
    expect(flag('NIKE')[0].reason).toMatch(/trademark/)
  })

  it('does not flag a trademark word that is also a common name', () => {
    // JORDAN as a surname is extremely common; only a shirt that reads exactly
    // a brand is a problem, and that is what the whole-value rule is for.
    expect(flag('JORDAN')).toEqual([])
    expect(flag('JORDANS')).toEqual([])
  })

  it('reports at most one reason per rule per field', () => {
    const flags = flag('FUCKSHIT')
    expect(flags).toHaveLength(1)
  })

  it('ignores empty values', () => {
    expect(reviewFlags(TEMPLATE, { name: '', number: '' })).toEqual([])
  })

  it('names the field so the team knows which one to look at', () => {
    const flags = reviewFlags(TEMPLATE, { name: 'SMITH', number: '' })
    expect(flags).toEqual([])
  })
})
