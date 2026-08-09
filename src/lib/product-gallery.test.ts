import { describe, it, expect } from 'vitest'
import { buildProductGallery } from './product-gallery'

// ---------------------------------------------------------------------------
// ROLE_ORDER is a WHITELIST, not a sort. A mockup role missing from it is
// invisible on the storefront no matter how many were rendered — the render is
// paid for, stored, and never seen, with no error anywhere. These tests pin the
// roles added 2026-08-09 (the two Etsy model shots and the pocket-scale shot)
// so a future edit can't quietly drop them again.
// ---------------------------------------------------------------------------

const asset = (asset_role: string, url: string, over: Record<string, unknown> = {}) => ({
  asset_role,
  url,
  kind: 'mockup',
  created_at: '2026-08-09T00:00:00Z',
  ...over,
})

describe('buildProductGallery', () => {
  it('includes the two mirrored model shots', () => {
    const out = buildProductGallery([
      asset('mockup_ghost_mannequin', 'ghost.png'),
      asset('mockup_model_1', 'model1.png'),
      asset('mockup_model_2', 'model2.png'),
    ])
    expect(out).toContain('model1.png')
    expect(out).toContain('model2.png')
  })

  it('includes the pocket shot, but never as the hero', () => {
    const out = buildProductGallery([
      asset('mockup_pocket', 'pocket.png'),
      asset('mockup_ghost_mannequin', 'ghost.png'),
      asset('mockup_flat_lay', 'flat.png'),
    ])
    expect(out).toContain('pocket.png')
    // Ghost mannequin owns the hero slot; the small-print variant must not
    // be the first thing a shopper sees.
    expect(out[0]).toBe('ghost.png')
    expect(out.indexOf('pocket.png')).toBeGreaterThan(out.indexOf('flat.png'))
  })

  it('keeps the watermarked design last, after every new mockup role', () => {
    const out = buildProductGallery([
      asset('design_watermarked', 'wm.png', { kind: 'design_preview' }),
      asset('mockup_pocket', 'pocket.png'),
      asset('mockup_model_1', 'model1.png'),
      asset('mockup_ghost_mannequin', 'ghost.png'),
    ])
    expect(out[out.length - 1]).toBe('wm.png')
  })

  it('orders the full set ghost → flat → mr imagine → models → pocket → watermark', () => {
    const out = buildProductGallery([
      asset('mockup_pocket', 'pocket.png'),
      asset('design_watermarked', 'wm.png', { kind: 'design_preview' }),
      asset('mockup_mr_imagine', 'mri.png'),
      asset('mockup_model_2', 'model2.png'),
      asset('mockup_flat_lay', 'flat.png'),
      asset('mockup_model_1', 'model1.png'),
      asset('mockup_ghost_mannequin', 'ghost.png'),
    ])
    expect(out).toEqual(['ghost.png', 'flat.png', 'mri.png', 'model1.png', 'model2.png', 'pocket.png', 'wm.png'])
  })

  it('still takes only the newest asset per role', () => {
    const out = buildProductGallery([
      asset('mockup_pocket', 'old-pocket.png', { created_at: '2026-01-01T00:00:00Z' }),
      asset('mockup_pocket', 'new-pocket.png', { created_at: '2026-08-09T00:00:00Z' }),
    ])
    expect(out).toEqual(['new-pocket.png'])
  })

  it('drops roleless assets only when a real role exists', () => {
    const out = buildProductGallery([
      asset('mockup_ghost_mannequin', 'ghost.png'),
      { kind: 'mockup', url: 'legacy.png', asset_role: null, created_at: null },
    ])
    expect(out).toEqual(['ghost.png'])
  })

  it('falls back to legacy roleless mockups when nothing is tagged', () => {
    const out = buildProductGallery([
      { kind: 'mockup', url: 'b.png', asset_role: null, display_order: 2 },
      { kind: 'mockup', url: 'a.png', asset_role: null, display_order: 1 },
    ])
    expect(out).toEqual(['a.png', 'b.png'])
  })

  it('never leaks a raw source design into the gallery', () => {
    const out = buildProductGallery([
      { kind: 'source', url: 'raw-design.png', asset_role: 'design' },
    ])
    expect(out).toEqual([])
  })
})
