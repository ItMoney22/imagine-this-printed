// Whose name a Stripe Checkout page wears.
//
// David, 2026-10-29: what a client sells on their site checks out in the
// CLIENT's name. 2026-11-13: "all checkouts be branded by them." Jalynn's and
// Darrell's merch is paid here, on ITP's Stripe, so without this their buyers
// landed on a page that said Imagine This Printed. Each Checkout Session now
// carries the seller's look itself (Stripe `branding_settings`):
//   - a creator storefront (routes/storefront.ts): the look the site sends in
//     the checkout body (`brand`), else the one kept here for that creator,
//     else ITP's own;
//   - a seller's store on ITP (routes/vendor-store.ts): the store's name and logo.
//
// Stripe fetches the pictures itself: public https, and the path must end
// .png, .jpg, .jpeg or .svg (never .webp). Dependency-free so it tests offline.

export type CheckoutBrand = {
  display_name: string
  logo?: { type: 'url'; url: string }
  icon?: { type: 'url'; url: string }
  background_color?: string
  button_color?: string
  border_style?: 'rounded' | 'rectangular' | 'pill'
}

export const ITP_CHECKOUT_BRAND: CheckoutBrand = {
  display_name: 'Imagine This Printed',
  logo: { type: 'url', url: 'https://imaginethisprinted.com/itp-logo-v3.png' },
  icon: { type: 'url', url: 'https://imaginethisprinted.com/itp-logo-v3.png' },
  background_color: '#fafafa',
  button_color: '#9333ea',
  border_style: 'rounded'
}

// Keyed by the creator's slug in STOREFRONT_CREATOR_KEYS (req.storefront.vendor).
// Every picture is that client's own live file.
export const CREATOR_CHECKOUT_BRANDS: Record<string, CheckoutBrand> = {
  jalynn: {
    display_name: 'Jalynn D. Simmons',
    logo: { type: 'url', url: 'https://jalynndsimmons.com/images/jalynn-d-simmons-logo-wide.png' },
    icon: { type: 'url', url: 'https://jalynndsimmons.com/favicon.png' },
    background_color: '#080d17',
    button_color: '#ac8945',
    border_style: 'rounded'
  },
  darrell: {
    display_name: 'Darrell McCutchen',
    logo: { type: 'url', url: 'https://darrellmccutchen.com/assets/darrell-logo-lockup.png' },
    icon: { type: 'url', url: 'https://darrellmccutchen.com/icon.png' },
    background_color: '#081020',
    button_color: '#2b81ec',
    border_style: 'rounded'
  }
}

const picture = (value: unknown): { type: 'url'; url: string } | undefined => {
  if (typeof value !== 'string' || value.length > 500) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && /\.(png|jpe?g|svg)$/i.test(url.pathname) ? { type: 'url', url: url.toString() } : undefined
  } catch {
    return undefined
  }
}
const colour = (value: unknown): string | undefined =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : undefined

/**
 * The look a storefront sent with its checkout: { displayName, logoUrl?, iconUrl?,
 * backgroundColor?, buttonColor? }. Trusted like its prices (the storefront key is
 * authenticated), but every field is still checked, and one bad field is dropped
 * rather than failing the sale. null when there is no usable name.
 */
export function brandFromRequest(raw: unknown): CheckoutBrand | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const name = typeof r.displayName === 'string' ? r.displayName.trim().slice(0, 80) : ''
  if (!name) return null
  const logo = picture(r.logoUrl)
  const icon = picture(r.iconUrl)
  const background = colour(r.backgroundColor)
  const button = colour(r.buttonColor)
  return {
    display_name: name,
    ...(logo ? { logo } : {}),
    ...(icon ? { icon } : {}),
    ...(background ? { background_color: background } : {}),
    ...(button ? { button_color: button } : {}),
    border_style: 'rounded'
  }
}

/** A creator storefront's look: what it sent, else what is kept for it, else ITP's. */
export function storefrontBrand(vendor: string | null | undefined, requested?: unknown): CheckoutBrand {
  return brandFromRequest(requested) || (vendor ? CREATOR_CHECKOUT_BRANDS[vendor] : undefined) || ITP_CHECKOUT_BRAND
}

/** A seller's store on ITP: its own name and logo on ITP's colours. */
export function vendorStoreBrand(store: { name: string; logo_url: string | null }): CheckoutBrand {
  const name = (store.name || '').trim().slice(0, 80)
  if (!name) return ITP_CHECKOUT_BRAND
  const logo = picture(store.logo_url)
  return {
    display_name: name,
    ...(logo ? { logo } : {}),
    background_color: ITP_CHECKOUT_BRAND.background_color,
    button_color: ITP_CHECKOUT_BRAND.button_color,
    border_style: 'rounded'
  }
}

/** A checkout shown inside the storefront's own page takes the name and colours only: Stripe refuses a logo or icon there. */
export function forEmbedded(brand: CheckoutBrand): CheckoutBrand {
  const rest = { ...brand }
  delete rest.logo
  delete rest.icon
  return rest
}

type SessionCreator<P, S> = { checkout: { sessions: { create(params: P): Promise<S> } } }

/**
 * Opens the Checkout in that look. The look is a nicety: if Stripe turns the
 * session down with it, the same session opens once more on the plain page, so
 * a sale never fails over a logo.
 */
export async function createBrandedCheckout<P extends object, S>(
  stripe: SessionCreator<P, S>,
  params: P,
  brand: CheckoutBrand
): Promise<S> {
  const embedded = String((params as { ui_mode?: unknown }).ui_mode ?? '').startsWith('embedded')
  try {
    // The installed SDK's types predate branding_settings; the API takes it.
    return await stripe.checkout.sessions.create({ ...params, branding_settings: embedded ? forEmbedded(brand) : brand } as P)
  } catch (error) {
    console.error('[checkout-brand] checkout opened without its look:', error instanceof Error ? error.message : error)
    return stripe.checkout.sessions.create(params)
  }
}
