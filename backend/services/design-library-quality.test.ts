import { describe, it, expect } from 'vitest'
import {
  MIN_PRINT_INCHES,
  minDpiFor,
  requiredShortEdgePx,
  checkPrintability,
  canActivate,
  partitionForActivation,
  quarantineRecord,
  releaseQuarantine
} from './design-library-quality.js'
import { SHEET_PRESETS } from '../config/imagination-presets.js'

const image = (width_px: number, height_px: number) => ({ image: { width_px, height_px } })

describe('threshold derivation', () => {
  it('comes from the print type minDPI, not a hardcoded number', () => {
    expect(minDpiFor('dtf')).toBe(SHEET_PRESETS.dtf.rules.minDPI)
    expect(minDpiFor('sublimation')).toBe(SHEET_PRESETS.sublimation.rules.minDPI)
    expect(requiredShortEdgePx('dtf')).toBe(SHEET_PRESETS.dtf.rules.minDPI * MIN_PRINT_INCHES)
  })

  it('falls back to the default print type for an unknown one', () => {
    expect(minDpiFor('nonsense' as any)).toBe(SHEET_PRESETS.dtf.rules.minDPI)
  })
})

describe('checkPrintability', () => {
  it('passes artwork whose short edge meets the requirement', () => {
    const check = checkPrintability(image(4500, 5400))
    expect(check.ok).toBe(true)
    expect(check.code).toBe('ok')
    expect(check.short_edge_px).toBe(4500)
  })

  it('passes artwork sitting exactly on the requirement', () => {
    expect(checkPrintability(image(requiredShortEdgePx(), 5000)).ok).toBe(true)
  })

  it('blocks the real low-res offenders from the library', () => {
    // Actual dimensions from the 39 flagged rows.
    for (const [w, h] of [[885, 728], [888, 830], [613, 1213], [716, 1156], [1080, 1296]]) {
      const check = checkPrintability(image(w, h))
      expect(check.ok).toBe(false)
      expect(check.code).toBe('too_small')
      expect(check.reason).toContain(`${w}x${h}px`)
      expect(check.reason).toContain(`${requiredShortEdgePx()}px`)
    }
  })

  it('blocks — never silently passes — artwork that was never measured', () => {
    for (const metadata of [null, {}, { image: null }, { image: {} }, { image: { width_px: 0, height_px: 0 } }]) {
      const check = checkPrintability(metadata as any)
      expect(check.ok).toBe(false)
      expect(check.code).toBe('unmeasured')
    }
  })

  it('ignores a stale printable:true written under an older threshold', () => {
    const stale = { image: { width_px: 900, height_px: 900, printable: true } }
    expect(checkPrintability(stale).ok).toBe(false)
  })
})

describe('canActivate', () => {
  it('lets an admin-released design through, and records that it was released', () => {
    const metadata = {
      image: { width_px: 885, height_px: 728 },
      quarantine: { released_at: '2026-07-28T00:00:00.000Z', override_reason: 'tiny sticker only' }
    }
    const verdict = canActivate(metadata)
    expect(verdict.allowed).toBe(true)
    expect(verdict.released).toBe(true)
    expect(verdict.check.ok).toBe(false) // the artwork is still too small — the reason survives
  })

  it('a quarantine record with no release does not unblock anything', () => {
    const metadata = { image: { width_px: 885, height_px: 728 }, quarantine: { code: 'too_small', reason: 'x' } }
    expect(canActivate(metadata).allowed).toBe(false)
  })
})

describe('partitionForActivation', () => {
  it('splits candidates and keeps the reason with each blocked row', () => {
    const rows = [
      { id: 'a', name: 'Big', metadata: image(4500, 5400) },
      { id: 'b', name: 'Tiny', metadata: image(885, 728) },
      { id: 'c', name: 'Unknown', metadata: {} }
    ]
    const { allowed, blocked } = partitionForActivation(rows)
    expect(allowed.map(r => r.id)).toEqual(['a'])
    expect(blocked.map(r => r.id)).toEqual(['b', 'c'])
    expect(blocked[0].check.code).toBe('too_small')
    expect(blocked[1].check.code).toBe('unmeasured')
    expect(blocked[0].check.reason.length).toBeGreaterThan(0)
  })
})

describe('quarantine records', () => {
  it('captures why, not just that', () => {
    const record = quarantineRecord(checkPrintability(image(885, 728)), 'admin-1')
    expect(record.code).toBe('too_small')
    expect(record.short_edge_px).toBe(728)
    expect(record.required_px).toBe(requiredShortEdgePx())
    expect(record.by).toBe('admin-1')
    expect(record.reason).toContain('blurry')
  })

  it('release keeps the original reason and adds the override', () => {
    const original = quarantineRecord(checkPrintability(image(885, 728)), 'admin-1')
    const released = releaseQuarantine(original, 'admin-2', 'sold as a 2in sticker')
    expect(released.reason).toBe(original.reason)
    expect(released.by).toBe('admin-1')
    expect(released.released_by).toBe('admin-2')
    expect(released.override_reason).toBe('sold as a 2in sticker')
    expect(canActivate({ image: { width_px: 885, height_px: 728 }, quarantine: released }).allowed).toBe(true)
  })
})
