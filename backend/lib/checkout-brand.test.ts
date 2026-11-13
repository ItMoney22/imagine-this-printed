// Whose name a Stripe Checkout wears (lib/checkout-brand.ts): a client's merch
// opens in the client's look, a refused look never loses the sale, and nothing
// a storefront sends can put a bad picture or colour on the page.
// Dependency-free: a stand-in Stripe client records what it was asked for.

import { describe, it, expect } from 'vitest'
import {
  ITP_CHECKOUT_BRAND,
  CREATOR_CHECKOUT_BRANDS,
  brandFromRequest,
  storefrontBrand,
  vendorStoreBrand,
  createBrandedCheckout,
} from './checkout-brand.js'

function client(refuseLook = false) {
  const calls: Record<string, any>[] = []
  const stripe = {
    checkout: {
      sessions: {
        create: async (params: Record<string, any>) => {
          calls.push(params)
          if (refuseLook && params.branding_settings) throw new Error('logo')
          return { id: 'cs_test_x', url: 'https://checkout.stripe.com/x' }
        },
      },
    },
  }
  return { stripe, calls }
}

describe('storefrontBrand', () => {
  it("gives Jalynn's and Darrell's merch their own name and logo", () => {
    expect(storefrontBrand('jalynn').display_name).toBe('Jalynn D. Simmons')
    expect(storefrontBrand('darrell').display_name).toBe('Darrell McCutchen')
  })

  it("falls back to ITP's own look for a storefront with none kept", () => {
    expect(storefrontBrand('earth019')).toEqual(ITP_CHECKOUT_BRAND)
    expect(storefrontBrand(null)).toEqual(ITP_CHECKOUT_BRAND)
  })

  it('lets the site send its own look, which wins', () => {
    const brand = storefrontBrand('jalynn', { displayName: ' Joyful Noyze ', logoUrl: 'https://jalynndsimmons.com/images/logo.png', buttonColor: '#AC8945' })
    expect(brand.display_name).toBe('Joyful Noyze')
    expect(brand.logo).toEqual({ type: 'url', url: 'https://jalynndsimmons.com/images/logo.png' })
    expect(brand.button_color).toBe('#ac8945')
  })

  it('keeps only pictures Stripe can use: public https ending png, jpg or svg', () => {
    for (const brand of [ITP_CHECKOUT_BRAND, ...Object.values(CREATOR_CHECKOUT_BRANDS)])
      for (const url of [brand.logo?.url, brand.icon?.url]) expect(url).toMatch(/^https:\/\/[^/]+\/.+\.(png|jpe?g|svg)$/)
  })
})

describe('brandFromRequest', () => {
  it('drops a bad field rather than the whole look', () => {
    const brand = brandFromRequest({ displayName: 'Shop', logoUrl: 'https://x.com/logo.webp', iconUrl: 'http://x.com/i.png', backgroundColor: 'red', buttonColor: '#123abc' })
    expect(brand).toEqual({ display_name: 'Shop', button_color: '#123abc', border_style: 'rounded' })
  })

  it('needs a name', () => {
    expect(brandFromRequest({ logoUrl: 'https://x.com/logo.png' })).toBeNull()
    expect(brandFromRequest('Shop')).toBeNull()
    expect(brandFromRequest(undefined)).toBeNull()
  })
})

describe('vendorStoreBrand', () => {
  it("uses the store's name and logo", () => {
    const brand = vendorStoreBrand({ name: "Crystal's Corner", logo_url: 'https://cdn.example.com/stores/crystal/logo.png' })
    expect(brand.display_name).toBe("Crystal's Corner")
    expect(brand.logo?.url).toBe('https://cdn.example.com/stores/crystal/logo.png')
  })

  it('keeps the name when the logo is one Stripe cannot use', () => {
    const brand = vendorStoreBrand({ name: 'Shop', logo_url: 'https://cdn.example.com/logo.webp' })
    expect(brand.display_name).toBe('Shop')
    expect(brand.logo).toBeUndefined()
  })
})

describe('createBrandedCheckout', () => {
  it('sends the look with the session', async () => {
    const { stripe, calls } = client()
    await createBrandedCheckout(stripe, { mode: 'payment' }, CREATOR_CHECKOUT_BRANDS.jalynn)
    expect(calls).toHaveLength(1)
    expect(calls[0].branding_settings).toEqual(CREATOR_CHECKOUT_BRANDS.jalynn)
  })

  it('sends the name and colours only for a checkout inside the site (Stripe refuses a logo there)', async () => {
    const { stripe, calls } = client()
    await createBrandedCheckout(stripe, { mode: 'payment', ui_mode: 'embedded' }, CREATOR_CHECKOUT_BRANDS.darrell)
    expect(calls[0].branding_settings.display_name).toBe('Darrell McCutchen')
    expect(calls[0].branding_settings.logo).toBeUndefined()
    expect(calls[0].branding_settings.icon).toBeUndefined()
    expect(CREATOR_CHECKOUT_BRANDS.darrell.logo).toBeDefined()
  })

  it('opens the plain page when Stripe refuses the look, so the sale still goes through', async () => {
    const { stripe, calls } = client(true)
    const session = await createBrandedCheckout(stripe, { mode: 'payment', success_url: 'https://x/ok' }, ITP_CHECKOUT_BRAND)
    expect(session.url).toBe('https://checkout.stripe.com/x')
    expect(calls).toHaveLength(2)
    expect(calls[1].branding_settings).toBeUndefined()
    expect(calls[1].success_url).toBe('https://x/ok')
  })
})
