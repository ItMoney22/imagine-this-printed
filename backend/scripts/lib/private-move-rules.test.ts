import { describe, expect, it } from 'vitest'
import {
  groupOf, publicPathOf, rewriteAttachments, rewriteProductMetadata, withoutMoved,
} from './private-move-rules.mjs'

const B = 'imagine-this-printed-main'
const G = `https://storage.googleapis.com/${B}`
const PRINT = 'print-ready/p1/art.png'
const moved = new Set([PRINT])

describe('groupOf', () => {
  it('takes the private prefixes', () => {
    expect(groupOf('users/inbound/email-attachments/a-0-report.xml.gz')).toBe('email')
    expect(groupOf('digital-products/abc.png')).toBe('digital')
    expect(groupOf(PRINT)).toBe('print-ready')
    expect(groupOf('users/3e409705/uploads/own-design-1.png')).toBe('uploads')
    expect(groupOf('users/pet-ornaments/photos/abc.png')).toBe('uploads')
  })

  it('leaves live mockups and everything the storefront shows where they are', () => {
    for (const path of [
      'users/3e409705/mockups/etsy_shot_a.png',
      'users/mrs-imagine/mockups/a.png',
      'users/system/mockups/p1-details-1.png',
      'users/pet-ornaments/portraits/abc.png',
      'users/pet-ornaments/geo-v1/k/print-spec.json',
      'users/team-plates/flare-v1/x-press.png',
      'mockups/a/hanger/a.png',
      'design-library/gaming/12.png',
    ]) expect(groupOf(path)).toBeNull()
  })
})

describe('publicPathOf', () => {
  it('reads plain, signed and percent-encoded links', () => {
    expect(publicPathOf(`${G}/${PRINT}`, B)).toBe(PRINT)
    expect(publicPathOf(`${G}/${PRINT}?GoogleAccessId=x&Signature=y`, B)).toBe(PRINT)
    expect(publicPathOf(`${G}/users/a%40b.com/uploads/x.png`, B)).toBe('users/a@b.com/uploads/x.png')
  })

  it('ignores anything that is not the public bucket', () => {
    expect(publicPathOf(`https://storage.googleapis.com/imagine-this-printed-products/${PRINT}`, B)).toBeNull()
    expect(publicPathOf(`gs://imagine-this-printed-products/${PRINT}`, B)).toBeNull()
    expect(publicPathOf('https://example.com/print-ready/p1/art.png', B)).toBeNull()
    expect(publicPathOf(null, B)).toBeNull()
  })
})

describe('withoutMoved', () => {
  it('drops the print file and keeps the gallery order', () => {
    const shot = `${G}/mockups/a/hanger/a.png?Signature=y`
    const card = `${G}/users/system/mockups/p1-details-1.png?Signature=y`
    expect(withoutMoved([`${G}/${PRINT}?Signature=y`, shot, card], B, moved)).toEqual([shot, card])
  })
})

describe('rewriteAttachments', () => {
  it('swaps only the moved file', () => {
    const other = { filename: 'b.png', url: `${G}/users/inbound/email-attachments/b.png?Signature=y` }
    const out = rewriteAttachments([{ filename: 'a.png', url: `${G}/${PRINT}?Signature=y` }, other], B, moved, (p: string) => `gs://private/${p}`)
    expect(out).toEqual([{ filename: 'a.png', url: `gs://private/${PRINT}` }, other])
  })
})

describe('rewriteProductMetadata', () => {
  const toRef = (p: string) => `gs://private/${p}`
  const toLink = (p: string) => `https://signed.example/${p}`

  it('gives the upscale record a reference and the artwork a link', () => {
    const out = rewriteProductMetadata(
      {
        step_flow: { idea: 'kept' },
        print_upscale: { at: 'now', results: [{ from: 'x', to: `${G}/${PRINT}?Signature=y` }, { from: 'y', to: null }] },
        print_artwork: { front_image: `${G}/${PRINT}?Signature=y`, originals: { front_image: 'kept' } },
      },
      B, moved, toRef, toLink
    )
    expect(out.print_upscale.results).toEqual([{ from: 'x', to: `gs://private/${PRINT}` }, { from: 'y', to: null }])
    expect(out.print_artwork).toEqual({ front_image: `https://signed.example/${PRINT}`, originals: { front_image: 'kept' } })
    expect(out.step_flow).toEqual({ idea: 'kept' })
  })

  it('leaves a product with neither field unchanged', () => {
    expect(rewriteProductMetadata({ a: 1 }, B, moved, toRef, toLink)).toEqual({ a: 1 })
  })
})
