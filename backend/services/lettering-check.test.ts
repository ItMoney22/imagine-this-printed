import { describe, it, expect } from 'vitest'
import { compareLettering, normalizeLettering } from './lettering-check.js'

describe('compareLettering', () => {
  it('catches the live 2026-09-24 miss: SMITH drawn as SMTH', () => {
    const v = compareLettering(['SMITH'], ['SMTH', '9'])
    expect(v.ok).toBe(false)
    expect(v.mismatches).toEqual([{ expected: 'SMITH', closest: 'SMTH' }])
  })

  it('passes exact matches regardless of case, quotes and spacing', () => {
    expect(compareLettering(['SMITH', '22'], ['smith', '22']).ok).toBe(true)
    expect(compareLettering(["O'BRIEN", '88'], ['OBRIEN', '88']).ok).toBe(true)
    expect(compareLettering(['DE LA CRUZ'], ['DE LA CRUZ']).ok).toBe(true)
  })

  it('finds a value inside a line the checker read as one', () => {
    expect(compareLettering(['SMITH', '22'], ['SMITH 22']).ok).toBe(true)
  })

  it('does not let a short number hide inside another number', () => {
    // "2" must not pass just because "22" was read.
    const v = compareLettering(['2'], ['22'])
    expect(v.ok).toBe(false)
  })

  it('skips empty expected values', () => {
    expect(compareLettering(['', 'LI'], ['LI']).ok).toBe(true)
  })

  it('normalizes to upper-case letters and digits', () => {
    expect(normalizeLettering(" o'Brien-2 ")).toBe('OBRIEN2')
  })
})
