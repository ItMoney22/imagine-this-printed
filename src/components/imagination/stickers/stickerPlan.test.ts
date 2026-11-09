import { describe, it, expect } from 'vitest'
import { planPack, stickerFileName, STICKER_TYPES } from './stickerPlan'
import { STICKER_STYLES } from '../../../../backend/shared/sticker-styles'

describe('planPack', () => {
  it('shows every chosen type before any repeats, and numbers the repeats', () => {
    expect(planPack(8, ['cartoon', 'kawaii', 'emoji'])).toEqual([
      { style: 'cartoon', variant: 0 },
      { style: 'kawaii', variant: 0 },
      { style: 'emoji', variant: 0 },
      { style: 'cartoon', variant: 1 },
      { style: 'kawaii', variant: 1 },
      { style: 'emoji', variant: 1 },
      { style: 'cartoon', variant: 2 },
      { style: 'kawaii', variant: 2 },
    ])
  })

  it('makes nothing without a type', () => {
    expect(planPack(8, [])).toEqual([])
  })

  it('names files in pack order', () => {
    expect(stickerFileName(2, 'kawaii')).toBe('sticker-03-kawaii-chibi.png')
  })

  it('offers exactly the types the backend accepts', () => {
    expect(STICKER_TYPES.map((t) => t.id).sort()).toEqual(Object.keys(STICKER_STYLES).sort())
  })
})
