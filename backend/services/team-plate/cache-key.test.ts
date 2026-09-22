import { describe, it, expect } from 'vitest'
import { templateCacheKey } from './cache-key.js'
import type { TeamField, TeamTemplate } from '../../shared/team-template.js'

const NAME_FIELD: TeamField = {
  key: 'name',
  label: 'Last name',
  type: 'text',
  max: 12,
  placeholder: 'LAST NAME',
  uppercase: true,
  zone: { x: 220, y: 380, w: 3160, h: 900 },
  arch: 18,
  font: { family: 'collegiate-slab', src: 'house' },
  fill: '#8C1D2D',
  strokes: [{ color: '#F2E0BC', w: 26 }],
  offset: null,
}

const NUMBER_FIELD: TeamField = {
  key: 'number',
  label: 'Number',
  type: 'number',
  max: 2,
  placeholder: '00',
  uppercase: false,
  zone: { x: 900, y: 1500, w: 1800, h: 2400 },
  arch: 0,
  font: { family: 'varsity-block', src: 'house' },
  fill: '#C9A227',
  strokes: [{ color: '#8C1D2D', w: 34 }],
  offset: null,
}

const TEMPLATE: TeamTemplate = {
  version: 1,
  side: 'back_image',
  plateAssetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  distressAssetId: null,
  canvas: { w: 3600, h: 4800, dpi: 300 },
  halftone: false,
  instructions: null,
  upcharge: 0,
  fields: [NAME_FIELD, NUMBER_FIELD],
}

describe('templateCacheKey', () => {
  it('is stable for the same values', () => {
    const a = templateCacheKey(TEMPLATE, { name: 'SMITH', number: '22' })
    const b = templateCacheKey(TEMPLATE, { number: '22', name: 'SMITH' })
    expect(a).toBe(b)
  })

  it('changes when a value changes', () => {
    const a = templateCacheKey(TEMPLATE, { name: 'SMITH', number: '22' })
    const b = templateCacheKey(TEMPLATE, { name: 'LOPEZ', number: '22' })
    expect(a).not.toBe(b)
  })

  it('changes when the template itself changes, so an edit invalidates derived files', () => {
    const a = templateCacheKey(TEMPLATE, { name: 'SMITH', number: '22' })
    const moved = { ...TEMPLATE, fields: [{ ...NAME_FIELD, fill: '#000000' }, NUMBER_FIELD] }
    const b = templateCacheKey(moved, { name: 'SMITH', number: '22' })
    expect(a).not.toBe(b)
  })
})
