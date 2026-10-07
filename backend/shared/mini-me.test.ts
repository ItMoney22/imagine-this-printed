import { describe, it, expect } from 'vitest'
import {
  MINI_ME_PRICE_CENTS,
  MINI_ME_PRICES_APPROVED,
  MINI_ME_NFC_ADDON_ID,
  isMiniMeSize,
  miniMeColorMode,
  miniMeBaseCents,
  miniMeUnitCents
} from './mini-me.js'

describe('Mini-Me pricing', () => {
  it('stays marked pending until David approves real numbers', () => {
    expect(MINI_ME_PRICES_APPROVED).toBe(false)
  })

  it('white includes the paint kit: the base is just the white price', () => {
    expect(miniMeBaseCents('small', 'white')).toBe(MINI_ME_PRICE_CENTS.white.small)
    expect(miniMeBaseCents('medium', 'white')).toBe(MINI_ME_PRICE_CENTS.white.medium)
  })

  it('full color adds the per-size upcharge on top of white', () => {
    expect(miniMeBaseCents('small', 'color4')).toBe(MINI_ME_PRICE_CENTS.white.small + MINI_ME_PRICE_CENTS.color4Upcharge.small)
    expect(miniMeBaseCents('medium', 'color4')).toBe(MINI_ME_PRICE_CENTS.white.medium + MINI_ME_PRICE_CENTS.color4Upcharge.medium)
  })

  it('the NFC video base is an add-on, counted only when chosen', () => {
    expect(miniMeUnitCents('small', 'white', [])).toBe(MINI_ME_PRICE_CENTS.white.small)
    expect(miniMeUnitCents('small', 'white', [MINI_ME_NFC_ADDON_ID])).toBe(MINI_ME_PRICE_CENTS.white.small + MINI_ME_PRICE_CENTS.nfcVideo)
  })

  it('anything that is not color4 is white; only small and medium are sizes', () => {
    expect(miniMeColorMode('color4')).toBe('color4')
    expect(miniMeColorMode('grey')).toBe('white')
    expect(miniMeColorMode(undefined)).toBe('white')
    expect(isMiniMeSize('small')).toBe(true)
    expect(isMiniMeSize('large')).toBe(false)
  })
})
