import { describe, it, expect } from 'vitest'
import { withQuery } from './query-string'

describe('withQuery', () => {
  it('sends no status at all when none is given (the empty-sheet bug sent status=undefined)', () => {
    expect(withQuery('/api/imagination-station/sheets', { status: undefined })).toBe('/api/imagination-station/sheets')
    expect(withQuery('/api/x', { status: null })).toBe('/api/x')
  })

  it('keeps real values, including 0, false and empty strings', () => {
    expect(withQuery('/api/x', { status: 'draft', page: 0, all: false, q: '' })).toBe('/api/x?status=draft&page=0&all=false&q=')
  })

  it('leaves a url alone with no params and appends to one that already has a query', () => {
    expect(withQuery('/api/x')).toBe('/api/x')
    expect(withQuery('/api/x?a=1', { b: 2 })).toBe('/api/x?a=1&b=2')
  })
})
