// Vendor storefronts on <slug>.imaginethisprinted.com (David 2026-10-26, Crystal first).
// The API is backend/routes/vendor-store.ts; the store page is src/pages/store/StorePage.tsx.
import { useCallback, useEffect, useState } from 'react'
import { API_BASE, apiFetch } from './api'
import { storeSlugFromHost } from './store-host'

export { storeSlugFromHost }

export type StoreTheme = {
  primary?: string; green?: string; pink?: string; gold?: string; ink?: string
  /** Art: hero backdrop, the cut-out character, the Meet-her portrait, the tab icon. */
  hero?: string; character?: string; portrait?: string; icon?: string
  /** Her store assistant's face (defaults to /stores/<slug>/assistant.webp). */
  assistant?: string
  ownerFirst?: string
  /** Her store assistant's first name (Crystal's is Rico). */
  assistantName?: string
  about?: string
}
export type StoreInfo = { slug: string; name: string; tagline: string | null; logoUrl: string | null; theme: StoreTheme; open: boolean; instagram: string | null }
export type StoreItem = {
  id: string
  kind: 'own' | 'itp'
  /** 'qr-stand': the buyer fills in a link, words and a logo (StoreStandFields). */
  lineType?: string | null
  name: string
  description: string | null
  images: string[]
  sizes: string[]
  colors: string[]
  priceCents: number
}
export type CartLine = { itemId: string; quantity: number; size?: string; color?: string; personalization?: Record<string, string> }

export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`

/** A US address as the store forms take it: the buyer's ship-to, her ship-from. */
export type ShipAddress = { name: string; street1: string; street2: string; city: string; state: string; zip: string; phone: string }
export const emptyAddress = (): ShipAddress => ({ name: '', street1: '', street2: '', city: '', state: '', zip: '', phone: '' })
/** Enough of an address to price shipping for (the server checks it properly). */
export const addressReady = (a: ShipAddress) =>
  !!(a.name.trim() && a.street1.trim() && a.city.trim() && /^[A-Za-z]{2}$/.test(a.state.trim()) && /^\d{5}(-\d{4})?$/.test(a.zip.trim()))

/** One shipping choice for the whole cart (both packages when her items and ITP's ship separately). */
export type ShippingOption = { id: string; name: string; days: number; amountCents: number; packages: number; token: string }

/** Where the store lives: its subdomain in production, /store/<slug> anywhere else. */
export function storeHome(slug: string): string {
  return storeSlugFromHost(window.location.hostname) === slug ? '/' : `/store/${slug}`
}

export async function fetchStore(slug: string): Promise<{ store: StoreInfo; items: StoreItem[] }> {
  const res = await fetch(`${API_BASE}/api/vendor-store/${encodeURIComponent(slug)}`)
  if (!res.ok) throw new Error(res.status === 404 ? 'not_found' : 'failed')
  return res.json()
}

/** Real carrier prices for this cart to this address (backend/services/vendor-store-shipping.ts). */
export async function quoteShipping(slug: string, lines: CartLine[], shipTo: ShipAddress): Promise<ShippingOption[]> {
  const res = await fetch(`${API_BASE}/api/vendor-store/${encodeURIComponent(slug)}/shipping-rates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: lines, shipTo })
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !Array.isArray(body.options)) throw new Error(body.error || 'Shipping prices didn’t load. Try again.')
  return body.options
}

export async function startCheckout(slug: string, lines: CartLine[], shipTo: ShipAddress, shippingQuote: string): Promise<string> {
  const res = await fetch(`${API_BASE}/api/vendor-store/${encodeURIComponent(slug)}/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: lines, shipTo, shippingQuote, cancelPath: storeHome(slug) === '/' ? '/' : undefined })
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.url) throw new Error(body.error === 'store_not_open' ? 'Checkout opens soon.' : body.error || 'Checkout failed')
  return body.url
}

/** The cart lives in this browser, per store (a subdomain has its own storage anyway). */
export function useStoreCart(slug: string) {
  const key = `vstore-cart:${slug}`
  const [lines, setLines] = useState<CartLine[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(key) || '[]')
      return Array.isArray(raw) ? raw : []
    } catch {
      return []
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(lines))
    } catch {
      /* private mode: the cart still works for this visit */
    }
  }, [key, lines])

  const add = useCallback((line: CartLine) => {
    setLines(prev => {
      // Two stands with different links are two lines, so the personalization is part of the match.
      const same = (l: CartLine) => JSON.stringify(l.personalization ?? null) === JSON.stringify(line.personalization ?? null)
      const i = prev.findIndex(l => l.itemId === line.itemId && l.size === line.size && l.color === line.color && same(l))
      if (i < 0) return [...prev, line]
      const next = [...prev]
      next[i] = { ...next[i], quantity: Math.min(20, next[i].quantity + line.quantity) }
      return next
    })
  }, [])
  const setQty = useCallback((index: number, quantity: number) => {
    setLines(prev => (quantity <= 0 ? prev.filter((_, i) => i !== index) : prev.map((l, i) => (i === index ? { ...l, quantity: Math.min(20, quantity) } : l))))
  }, [])
  const clear = useCallback(() => setLines([]), [])
  return { lines, add, setQty, clear, count: lines.reduce((n, l) => n + l.quantity, 0) }
}

// ---- Manage (Crystal + ITP admins), signed in on imaginethisprinted.com ----

export type ManageItem = StoreItem & { active: boolean; itpCostCents: number; suggestedPriceCents: number | null; sort: number }
export type ManageData = {
  isAdmin: boolean
  store: StoreInfo & {
    status: 'draft' | 'live' | 'paused'
    feePercent: number
    ownShippingCents: number
    itpShippingCents: number
    ownerEmail: string | null
    /** Where she ships her own items from (her labels are bought from here). */
    shipFrom: ShipAddress | null
    url: string
  }
  payouts: { hasAccount: boolean; ready: boolean; detailsSubmitted: boolean }
  items: ManageItem[]
  orders: Array<{
    orderNumber: string
    createdAt: string
    totalCents: number
    yourShareCents: number | null
    customer: string | null
    fulfillment: string
    items: Array<{ name: string; quantity: number; size?: string; color?: string; maker: 'vendor' | 'itp' }>
    /** What her package's shipping charged (it pays for her label). */
    shipping: { chargeCents: number; service: string } | null
    label: SellerLabel | null
  }>
}
export type SellerLabel = { trackingNumber: string | null; trackingUrl: string | null; carrier: string | null; service: string | null; purchasedAt: string }

const manage = (slug: string, rest = '') => `/api/vendor-store/manage/${encodeURIComponent(slug)}${rest}`

export const vendorStoreApi = {
  mine: (): Promise<{ stores: Array<{ slug: string; name: string; logo_url: string | null; status: string }>; isAdmin: boolean }> =>
    apiFetch('/api/vendor-store/manage/mine'),
  load: (slug: string): Promise<ManageData> => apiFetch(manage(slug)),
  saveStore: (slug: string, patch: Record<string, unknown>) => apiFetch(manage(slug), { method: 'PATCH', body: JSON.stringify(patch) }),
  saveItem: (slug: string, id: string, patch: Record<string, unknown>) =>
    apiFetch(manage(slug, `/items/${id}`), { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteItem: (slug: string, id: string) => apiFetch(manage(slug, `/items/${id}`), { method: 'DELETE' }),
  searchCatalog: (slug: string, q: string): Promise<{ products: Array<{ id: string; name: string; priceCents: number; costCents: number | null; image: string | null }> }> =>
    apiFetch(manage(slug, `/itp-catalog?q=${encodeURIComponent(q)}`)),
  offer: (slug: string, productId: string, itpCostCents: number) =>
    apiFetch(manage(slug, '/offer'), { method: 'POST', body: JSON.stringify({ productId, itpCostCents }) }),
  /** `returnTo: 'start'` brings her back to the sign-up flow instead of the store manager. */
  payoutsLink: (slug: string, returnTo?: 'start'): Promise<{ url: string }> =>
    apiFetch(manage(slug, '/payouts-link'), { method: 'POST', ...(returnTo ? { body: JSON.stringify({ returnTo }) } : {}) }),
  /** Buys her package's label (once; a second press hands back the same one). */
  printLabel: (slug: string, orderNumber: string): Promise<{ ok: true; alreadyPurchased?: boolean; label: SellerLabel }> =>
    apiFetch(manage(slug, `/orders/${encodeURIComponent(orderNumber)}/label`), { method: 'POST' }),
  /** Saves her label PDF to this device. */
  async downloadLabel(slug: string, orderNumber: string): Promise<void> {
    const { supabase } = await import('./supabase')
    const { data } = await supabase.auth.getSession()
    const res = await fetch(`${API_BASE}${manage(slug, `/orders/${encodeURIComponent(orderNumber)}/label.pdf`)}`, {
      headers: data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {}
    })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'The label didn’t download. Try again.')
    const url = URL.createObjectURL(await res.blob())
    const a = document.createElement('a')
    a.href = url
    a.download = `label-${orderNumber}.pdf`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
  },
  credits: (slug: string): Promise<StoreCredits> => apiFetch(manage(slug, '/credits')),
  speak: (slug: string, text: string): Promise<{ audioUrl: string }> =>
    apiFetch(manage(slug, '/assistant/speak'), { method: 'POST', body: JSON.stringify({ text }) }),
  /** Her store inbox (backend/routes/vendor-store-inbox.ts): the owner and ITP admins only. */
  inbox: (slug: string, folder: InboxFolder): Promise<InboxList> => apiFetch(manage(slug, `/inbox?folder=${folder}`)),
  inboxMessage: (slug: string, id: string): Promise<{ message: InboxMessage; replies: InboxReply[] }> => apiFetch(manage(slug, `/inbox/${id}`)),
  reply: (slug: string, id: string, text: string): Promise<{ ok: true; reply: InboxReply }> =>
    apiFetch(manage(slug, `/inbox/${id}/reply`), { method: 'POST', body: JSON.stringify({ text }) }),
  setJunk: (slug: string, id: string, junk: boolean) => apiFetch(manage(slug, `/inbox/${id}`), { method: 'PATCH', body: JSON.stringify({ junk }) }),
  /** Multipart: apiFetch forces JSON, so this one sets only the token. */
  addItem: (slug: string, form: FormData): Promise<{ item: StoreItem }> => postForm(manage(slug, '/items'), form, 'Could not save'),
  /** Her chat with the assistant as the server keeps it, oldest first. */
  /** The design a reply offered to make into a product, as a data URL (for customerStepFlow.upload). */
  design: (slug: string, messageId: string): Promise<{ image: string; filename: string }> =>
    apiFetch(manage(slug, `/assistant/design/${encodeURIComponent(messageId)}`)),
  history: (slug: string): Promise<{ messages: AssistantMessage[] }> => apiFetch(manage(slug, '/assistant/history')),
  /** One assistant turn: what she typed, her voice note when she talked, a picture of a design. The server reads the
   *  chat so far itself and answers with both turns as saved. */
  ask(slug: string, turn: { text?: string; audio?: Blob; image?: File }): Promise<AssistantAnswer> {
    const form = new FormData()
    if (turn.text) form.append('text', turn.text)
    if (turn.audio) form.append('audio', turn.audio, `voice.${turn.audio.type.includes('mp4') ? 'm4a' : turn.audio.type.includes('ogg') ? 'ogg' : 'webm'}`)
    if (turn.image) form.append('image', turn.image, turn.image.name || 'design.png')
    return postForm(manage(slug, '/assistant'), form, 'The assistant didn’t answer')
  }
}

export type InboxFolder = 'inbox' | 'junk'
export type InboxRow = { id: string; fromName: string; fromAddress: string; subject: string; preview: string; at: string; read: boolean; attachments: number }
export type InboxList = { address: string | null; folder: InboxFolder; unread: number; junk: number; messages: InboxRow[] }
export type InboxReply = { at: string; text: string }
export type InboxMessage = {
  id: string
  fromName: string
  fromAddress: string
  to: string[]
  subject: string
  at: string
  html: string | null
  text: string | null
  attachments: Array<{ filename: string; size: number; url: string | null }>
  junk: boolean
}

/** imageUrl on a reply is the design it offers to make into a product (makeProduct). */
export type AssistantMessage = {
  id?: string
  role: 'user' | 'assistant'
  text: string
  imageUrl?: string | null
  makeProduct?: boolean
  createdAt?: string
}
export type AssistantAnswer = { heard: string | null; reply: string; makeProduct: boolean; imageUrl: string | null; messages: AssistantMessage[] }
export type StoreCredits = {
  linked: boolean
  balance: number | null
  prices: Array<{ label: string; itc: number }>
  recent: Array<{ at: string; amount: number; what: string }>
}

async function postForm(path: string, form: FormData, fallback: string) {
  const { supabase } = await import('./supabase')
  const { data } = await supabase.auth.getSession()
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {},
    body: form
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || fallback)
  return body
}
