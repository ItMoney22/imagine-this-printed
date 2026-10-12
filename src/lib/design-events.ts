// ---------------------------------------------------------------------------
// Design performance beacons (task 47174caa). The shop reports which designs
// are seen, clicked, opened and carted, so the admin Design Performance page
// can show click-through and add-to-cart per AI prompt.
//
//   impression   a tile was half on screen (once per tab session per product
//                per page type)
//   click        a tile was clicked through to its product page
//   detail_view  a product page opened
//   add_to_cart  a house design went into the cart
//
// Events queue in memory and go out every few seconds, and when the tab hides,
// as one text/plain fetch with keepalive (no preflight, survives navigation).
// Only a per-tab random id is sent, never who the shopper is. A browser that
// has opened the admin is staff and sends nothing, so the shop's own browsing
// never counts. Orders are not sent from here: the API reads paid orders.
// ---------------------------------------------------------------------------

export type DesignEventType = 'impression' | 'click' | 'detail_view' | 'add_to_cart'

interface QueuedEvent { t: DesignEventType; p: string; s: string }

// Same base as src/lib/api.ts, without pulling the Supabase client into the cart.
const API_BASE = import.meta.env.VITE_API_BASE || import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:4000' : '')
const ENDPOINT = `${API_BASE}/api/design-events`
const FLUSH_MS = 8000
const MAX_BATCH = 50
const SID_KEY = 'itp_dsid'
const SEEN_KEY = 'itp_dseen'
const STAFF_KEY = 'itp_staff'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const queue: QueuedEvent[] = []
let timer: ReturnType<typeof setTimeout> | null = null
let seen: Set<string> | null = null
let listening = false

/** Page type for an event, from the URL the shopper is on. */
export function surfaceForPath(pathname: string): string {
  if (pathname === '/' || pathname === '') return 'home'
  if (pathname.startsWith('/catalog')) return 'catalog'
  if (pathname.startsWith('/product/')) return 'product'
  if (pathname.startsWith('/cart')) return 'cart'
  if (pathname.startsWith('/vendor/storefront')) return 'storefront'
  if (pathname.startsWith('/toys')) return 'toys'
  return 'other'
}

const currentSurface = () => (typeof window === 'undefined' ? 'other' : surfaceForPath(window.location.pathname))

function storage(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage
  } catch {
    return null
  }
}

/** Called by the admin shell: this browser is the shop's own, stop counting it. */
export function markStaffBrowser(): void {
  storage('local')?.setItem(STAFF_KEY, '1')
}

const isStaffBrowser = () => storage('local')?.getItem(STAFF_KEY) === '1'

function sessionId(): string {
  const store = storage('session')
  let sid = store?.getItem(SID_KEY) || ''
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(sid)) {
    sid = (typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
    ).replace(/[^A-Za-z0-9]/g, '')
    store?.setItem(SID_KEY, sid)
  }
  return sid
}

function seenImpressions(): Set<string> {
  if (!seen) {
    try {
      seen = new Set(JSON.parse(storage('session')?.getItem(SEEN_KEY) || '[]'))
    } catch {
      seen = new Set()
    }
  }
  return seen
}

export function flushDesignEvents(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  while (queue.length > 0) {
    const events = queue.splice(0, MAX_BATCH)
    fetch(ENDPOINT, {
      method: 'POST',
      keepalive: true,
      credentials: 'omit',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ sid: sessionId(), events }),
    }).catch(() => { /* analytics never bothers the shopper */ })
  }
}

function listenForHide() {
  if (listening || typeof document === 'undefined') return
  listening = true
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushDesignEvents()
  })
  window.addEventListener('pagehide', flushDesignEvents)
}

export function trackDesignEvent(type: DesignEventType, productId: string | null | undefined, surface = currentSurface()): void {
  if (typeof window === 'undefined' || !productId || !UUID.test(productId) || isStaffBrowser()) return
  if (type === 'impression') {
    const key = `${productId}|${surface}`
    const set = seenImpressions()
    if (set.has(key)) return
    set.add(key)
    try {
      storage('session')?.setItem(SEEN_KEY, JSON.stringify([...set].slice(-500)))
    } catch { /* full storage only means a repeat impression */ }
  }
  queue.push({ t: type, p: productId, s: surface })
  listenForHide()
  if (queue.length >= MAX_BATCH) flushDesignEvents()
  else if (!timer) timer = setTimeout(flushDesignEvents, FLUSH_MS)
}

// One shared observer for every tile on the page.
let observer: IntersectionObserver | null = null
const watched = new WeakMap<Element, string>()

function tileObserver(): IntersectionObserver | null {
  if (observer || typeof IntersectionObserver === 'undefined') return observer
  observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      const productId = watched.get(entry.target)
      if (productId) trackDesignEvent('impression', productId)
      observer?.unobserve(entry.target)
    }
  }, { threshold: 0.5 })
  return observer
}

/**
 * Ref callback for a product tile: counts one impression the first time the
 * tile is half on screen. Pair it with designTileClick on the tile's root.
 */
export function observeDesignTile(productId: string) {
  return (el: Element | null) => {
    if (!el) return
    const obs = tileObserver()
    if (!obs) return
    watched.set(el, productId)
    obs.observe(el)
  }
}

/** Click handler (capture phase) for a tile: counts clicks that open the product page. */
export function designTileClick(productId: string) {
  return (event: { target: EventTarget | null }) => {
    const target = event.target as Element | null
    const link = target?.closest?.('a[href]')
    if (link && /\/product\//.test(link.getAttribute('href') || '')) trackDesignEvent('click', productId)
  }
}
