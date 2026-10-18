import { describe, it, expect } from 'vitest'
import QRCode from 'qrcode'
import {
  QR_STAND,
  QR_TOO_LONG,
  QR_LINK_MAX_BYTES,
  QR_FIELD,
  isQrStandLineId,
  normalizeQrLink,
  qrLinkProblem,
  cleanQrCaption,
  qrCaptionProblem,
  isQrLogoPath,
  readQrStandFields,
} from './qr-stand'

const LINK_58 = 'https://example.com/' + 'a'.repeat(38)

describe('QR stand facts', () => {
  it('is $25 on sale for $17.95 (David 2026-10-17)', () => {
    expect(QR_STAND.wasCents).toBe(2500)
    expect(QR_STAND.priceCents).toBe(1795)
  })

  it('recognises its cart line ids and nothing else', () => {
    expect(isQrStandLineId('qr-stand')).toBe(true)
    expect(isQrStandLineId('qr-stand-1700000000')).toBe(true)
    expect(isQrStandLineId('qr-standard')).toBe(false)
    expect(isQrStandLineId('11111111-1111-1111-1111-111111111111')).toBe(false)
    expect(isQrStandLineId(undefined)).toBe(false)
  })
})

describe('the link rule', () => {
  it('adds https:// to a bare domain and trims', () => {
    expect(normalizeQrLink('  bellascafe.com/menu ')).toBe('https://bellascafe.com/menu')
    expect(normalizeQrLink('http://x.co')).toBe('http://x.co')
    expect(normalizeQrLink('')).toBe('')
  })

  it('takes 58 bytes and refuses 59 with "use a shorter link"', () => {
    expect(LINK_58.length).toBe(QR_LINK_MAX_BYTES)
    expect(qrLinkProblem(LINK_58)).toBeNull()
    expect(qrLinkProblem(LINK_58 + 'b')).toBe(QR_TOO_LONG)
    expect(QR_TOO_LONG).toBe('use a shorter link')
  })

  it('counts bytes, not letters: an accented link fills up sooner', () => {
    const accented = 'https://example.com/' + '\u00e9'.repeat(19) // 39 letters, 58 bytes
    expect(accented.length).toBeLessThan(QR_LINK_MAX_BYTES)
    expect(qrLinkProblem(accented)).toBeNull()
    expect(qrLinkProblem(accented + 'a')).toBe(QR_TOO_LONG)
  })

  it('agrees with a real QR encoder: 58 bytes is version 6 at level H, 59 is 7', () => {
    const v = (s: string) => QRCode.create([{ data: s, mode: 'byte' }], { errorCorrectionLevel: 'H' }).version
    expect(v(LINK_58)).toBe(6)
    expect(v(LINK_58 + 'b')).toBe(7)
  })

  it('refuses things that are not web links', () => {
    expect(qrLinkProblem('')).toMatch(/Type where/)
    expect(qrLinkProblem('https://has space.com')).toMatch(/no spaces/)
    expect(qrLinkProblem('ftp://files.example.com')).toMatch(/web link/)
    expect(qrLinkProblem('https://localhost')).toMatch(/web link/)
  })
})

describe('the caption rule', () => {
  it('collapses spaces and accepts the presets', () => {
    expect(cleanQrCaption('  Review   Us ')).toBe('Review Us')
    for (const c of ['Review Us', 'Pay Here', 'Visit Our Website', 'Scan For Menu']) expect(qrCaptionProblem(c)).toBeNull()
  })

  it('refuses empty, too long and characters the stand cannot letter', () => {
    expect(qrCaptionProblem('')).toMatch(/Pick/)
    expect(qrCaptionProblem('x'.repeat(25))).toMatch(/under 24/)
    expect(qrCaptionProblem('Caf\u00e9 & Bar!')).toBeNull()
    expect(qrCaptionProblem('Hi \u{1F600}')).toMatch(/simple punctuation/)
  })
})

describe('reading a cart line', () => {
  const logo = 'qr-stand-logos/0f8fad5b-d9cb-469f-a165-70867728950e.png'

  it('keeps a logo only as a path under our own prefix', () => {
    expect(isQrLogoPath(logo)).toBe(true)
    expect(isQrLogoPath('https://evil.example.com/logo.png')).toBe(false)
    expect(isQrLogoPath('qr-stand-logos/../secrets.png')).toBe(false)
  })

  it('reads the fields and passes a good line', () => {
    const { fields, problem } = readQrStandFields({
      [QR_FIELD.link]: 'bellascafe.com/menu',
      [QR_FIELD.caption]: 'Scan For Menu',
      [QR_FIELD.logoPath]: logo,
      [QR_FIELD.logoUrl]: 'https://anything/display-only.png',
    })
    expect(problem).toBeNull()
    expect(fields).toEqual({ link: 'https://bellascafe.com/menu', caption: 'Scan For Menu', logoPath: logo, ref: null })
  })

  it('stops a forged logo and a long link', () => {
    expect(readQrStandFields({ qr_link: 'x.com', qr_caption: 'Pay Here', qr_logo_path: 'https://evil/x.png' }).problem).toMatch(/logo again/)
    expect(readQrStandFields({ qr_link: LINK_58 + 'b', qr_caption: 'Pay Here' }).problem).toBe(QR_TOO_LONG)
    expect(readQrStandFields(null).problem).toMatch(/Type where/)
  })
})
