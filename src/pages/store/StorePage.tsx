// A seller's own storefront: crystal.imaginethisprinted.com (and /store/:slug on ITP itself).
// Built to David's approved mock (page_mockup_approvals 0074b39b, 2026-10-26). Buyers check out
// through ITP's Stripe; the seller is paid by destination charge (backend/routes/vendor-store.ts).
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { CandlestickChart, CupSoda, Gift, Instagram, Lock, MessageCircle, Minus, Plus, ShieldCheck, Shirt, ShoppingCart, Sparkles, Trash2, Truck, X, Flame } from 'lucide-react'
import {
  addressReady, emptyAddress, fetchStore, money, quoteShipping, startCheckout, useStoreCart,
  type CartLine, type ShipAddress, type ShippingOption, type StoreInfo, type StoreItem
} from '../../lib/vendor-store'
import ProgressBar from '../../components/studio/ProgressBar'
import StoreAddressFields from './StoreAddressFields'
import StoreStandFields, { type StandChoice } from './StoreStandFields'
import './store.css'

const ITP_HOME = 'https://imaginethisprinted.com'

// Chips are read from the item names, and only chips with something in them show.
const CHIPS = [
  { key: 'shirts', label: 'Shirts', icon: Shirt, colour: 'var(--vs-primary)', match: /shirt|tee\b|tees\b|hoodie|sweat|tank|onesie/i },
  { key: 'tumblers', label: 'Tumblers', icon: CupSoda, colour: 'var(--vs-green)', match: /tumbler|cup|mug|bottle/i },
  { key: 'candles', label: 'Candles', icon: Flame, colour: 'var(--vs-gold)', match: /candle/i },
  { key: 'gifts', label: 'Gifts', icon: Gift, colour: 'var(--vs-pink)', match: null },
] as const
type ChipKey = (typeof CHIPS)[number]['key']
const chipOf = (item: StoreItem): ChipKey => CHIPS.find(c => c.match && c.match.test(item.name))?.key ?? 'gifts'

export default function StorePage({ slug: slugProp }: { slug?: string }) {
  const params = useParams()
  const slug = (slugProp || params.slug || '').toLowerCase()
  const [search, setSearch] = useSearchParams()
  const [store, setStore] = useState<StoreInfo | null>(null)
  const [items, setItems] = useState<StoreItem[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading')
  const [chip, setChip] = useState<ChipKey | null>(null)
  const [open, setOpen] = useState<StoreItem | null>(null)
  const [cartOpen, setCartOpen] = useState(false)
  const cart = useStoreCart(slug)
  const thanks = search.get('thanks')

  useEffect(() => {
    let alive = true
    fetchStore(slug)
      .then(d => { if (alive) { setStore(d.store); setItems(d.items); setState('ready') } })
      .catch(e => alive && setState(e.message === 'not_found' ? 'missing' : 'error'))
    return () => { alive = false }
  }, [slug])

  // Her name and icon in the browser tab, not ITP's.
  useEffect(() => {
    if (!store) return
    const prevTitle = document.title
    document.title = `${store.name} | Imagine This Printed`
    const icon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')
    const prevIcon = icon?.href
    if (icon && store.theme?.icon) icon.href = store.theme.icon
    return () => { document.title = prevTitle; if (icon && prevIcon) icon.href = prevIcon }
  }, [store])

  // Back from a paid Stripe checkout: empty the cart once.
  const clearCart = cart.clear
  useEffect(() => { if (thanks) clearCart() }, [thanks, clearCart])

  const chips = useMemo(() => CHIPS.filter(c => items.some(i => chipOf(i) === c.key)), [items])
  const shown = chip ? items.filter(i => chipOf(i) === chip) : items
  const featured = items.find(i => i.kind === 'itp' && /candle/i.test(i.name)) || items.find(i => i.kind === 'itp')
  const byId = useMemo(() => new Map(items.map(i => [i.id, i])), [items])

  if (state === 'loading') {
    return <div className="vstore grid place-items-center"><div className="w-10 h-10 rounded-full border-2 border-[var(--vs-primary)] border-t-transparent animate-spin" /></div>
  }
  if (state !== 'ready' || !store) {
    return (
      <div className="vstore grid place-items-center px-6 text-center">
        <div>
          <p className="vs-display text-3xl mb-3">{state === 'missing' ? 'This store isn’t here.' : 'The store didn’t load.'}</p>
          <a className="underline text-[var(--vs-primary)]" href={ITP_HOME}>Shop Imagine This Printed</a>
        </div>
      </div>
    )
  }

  const t = store.theme || {}
  const rootStyle = {
    ...(t.primary ? { '--vs-primary': t.primary } : {}),
    ...(t.green ? { '--vs-green': t.green } : {}),
    ...(t.pink ? { '--vs-pink': t.pink } : {}),
    ...(t.gold ? { '--vs-gold': t.gold } : {}),
    ...(t.ink ? { '--vs-ink': t.ink } : {}),
  } as CSSProperties
  const heroWord = /shirts/i.exec(store.name)?.[0]
  const [nameBefore, nameAfter] = heroWord ? store.name.split(heroWord) : [store.name, '']
  const ownerFirst = t.ownerFirst || store.name.split(/[’']/)[0]
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <div className="vstore" style={rootStyle}>
      {/* 1. Top bar */}
      <header className="vs-bar">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-3">
          {store.logoUrl && <img src={store.logoUrl} alt="" className="h-11 w-11 object-contain" />}
          <span className="vs-display text-white text-lg sm:text-2xl truncate">{store.name}</span>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => setCartOpen(true)} className="relative flex items-center gap-2 rounded-full border border-white/40 text-white px-3 sm:px-4 h-10 hover:bg-white/10" aria-label={`Cart, ${cart.count} items`}>
              <ShoppingCart className="w-5 h-5" />
              <span className="hidden sm:inline text-sm font-medium">Cart</span>
              {cart.count > 0 && <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-[var(--vs-pink)] text-[11px] font-bold grid place-items-center">{cart.count}</span>}
            </button>
            {store.instagram && (
              <a href={`https://instagram.com/${store.instagram}`} target="_blank" rel="noreferrer" aria-label={`${store.name} on Instagram`} className="w-10 h-10 rounded-full border border-white/40 text-white grid place-items-center hover:bg-white/10">
                <Instagram className="w-5 h-5" />
              </a>
            )}
            <a href={ITP_HOME} className="hidden md:inline-flex items-center rounded-full border border-white/40 text-white/90 text-xs px-3 h-8 hover:bg-white/10">Powered by Imagine This Printed</a>
          </div>
        </div>
      </header>

      {thanks && (
        <div className="bg-[var(--vs-green)] text-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
            <Sparkles className="w-5 h-5 shrink-0" />
            <p className="text-sm sm:text-base">Thank you! Order <strong>{thanks}</strong> is in. Your receipt is on its way to your email.</p>
            <button className="ml-auto" aria-label="Close" onClick={() => { search.delete('thanks'); setSearch(search, { replace: true }) }}><X className="w-5 h-5" /></button>
          </div>
        </div>
      )}

      {/* 2. Hero */}
      <section className="vs-hero">
        {t.hero && <div className="vs-hero-bg" style={{ backgroundImage: `url(${t.hero})` }} />}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-10 pb-12 lg:py-16 grid lg:grid-cols-[1.05fr_1fr] gap-6 items-center">
          <div className="relative z-10">
            <p className="flex items-center gap-2 text-[11px] sm:text-sm tracking-[0.14em] sm:tracking-[0.2em] uppercase text-white/80 mb-4">
              <span className="vs-eyebrow-dot" /> Made to order · shipped to your door
            </p>
            <h1 className="vs-display font-bold leading-[0.95] text-[3.2rem] sm:text-7xl lg:text-[5.6rem]">
              {nameBefore}
              {heroWord && <><br /><span className="vs-rainbow-text">{heroWord}</span><br /></>}
              {nameAfter}
            </h1>
            {store.tagline && <p className="mt-5 text-lg sm:text-xl text-white/90 max-w-md">{store.tagline}</p>}
            <div className="mt-7 flex flex-wrap gap-3">
              <button onClick={() => go('shop')} className="vs-btn-solid rounded-full px-6 h-12 font-semibold">Shop now →</button>
              {featured && (
                <button onClick={() => { setChip(chipOf(featured)); go('shop') }} className="vs-btn-ghost rounded-full px-6 h-12 font-semibold">Gifts and candles</button>
              )}
            </div>
          </div>
          <div className="relative flex justify-center lg:justify-end">
            {[[8, 12], [82, 6], [92, 58], [4, 70], [48, 2]].map(([l, tp], i) => (
              <Sparkles key={i} className="vs-sparkle w-6 h-6" style={{ left: `${l}%`, top: `${tp}%`, animationDelay: `${i * 0.5}s` }} />
            ))}
            {t.character && (
              <img src={t.character} alt={store.name} className="vs-character w-[78%] sm:w-[60%] lg:w-[92%] max-w-[560px]" />
            )}
          </div>
        </div>
      </section>

      <main id="shop" className="max-w-7xl mx-auto px-4 sm:px-6 scroll-mt-20">
        {/* 3. Category chips */}
        {chips.length > 1 && (
          <div className="flex flex-wrap justify-center gap-6 sm:gap-14 py-8">
            {chips.map(c => {
              const Icon = c.icon
              return (
                <button key={c.key} className="vs-chip flex items-center gap-3" aria-pressed={chip === c.key} onClick={() => setChip(chip === c.key ? null : c.key)}>
                  <span className="vs-chip-icon" style={{ background: c.colour }}><Icon className="w-7 h-7" /></span>
                  <span className="font-semibold">{c.label}</span>
                </button>
              )
            })}
          </div>
        )}

        {/* 4. Products */}
        {items.length === 0 ? (
          <div className="my-12 rounded-3xl bg-white border border-[var(--vs-line)] p-8 sm:p-12 text-center">
            <Sparkles className="w-10 h-10 mx-auto text-[var(--vs-gold)]" />
            <p className="vs-display text-3xl mt-3">New pieces are on the way.</p>
            <p className="text-[var(--vs-muted)] mt-2">{ownerFirst} is in the craft room. Check back soon.</p>
          </div>
        ) : (
          <div className={`grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5 ${chips.length > 1 ? '' : 'pt-8'}`}>
            {shown.map((item, i) => (
              <article key={item.id} className="vs-card flex flex-col" style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }}>
                <button className="relative aspect-square overflow-hidden bg-[#f1ebf6]" onClick={() => setOpen(item)} aria-label={`See ${item.name}`}>
                  {item.images[0] && <img src={item.images[0]} alt={item.name} className="w-full h-full object-cover" loading="lazy" />}
                  <span className={`vs-tag absolute top-2 left-2 ${item.kind === 'own' ? 'vs-tag-own' : 'vs-tag-itp'}`}>
                    {item.kind === 'own' ? `Made by ${ownerFirst}` : 'Made by Imagine This Printed'}
                  </span>
                </button>
                <div className="p-3 sm:p-4 flex flex-col gap-1 flex-1">
                  <button onClick={() => setOpen(item)} className="text-left font-medium leading-snug">{item.name}</button>
                  <p className="text-[var(--vs-primary)] font-bold text-lg">{money(item.priceCents)}</p>
                  <button
                    className="vs-btn-pink mt-auto rounded-xl h-10 text-sm font-semibold flex items-center justify-center gap-2"
                    onClick={() => (item.sizes.length || item.colors.length > 1 || item.lineType ? setOpen(item) : (cart.add({ itemId: item.id, quantity: 1, color: item.colors[0] }), setCartOpen(true)))}
                  >
                    <ShoppingCart className="w-4 h-4" /> {item.lineType ? 'Make yours' : item.sizes.length ? 'Pick a size' : 'Add to cart'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}

        {/* 5. Featured ITP product */}
        {featured && (
          <section className="vs-feature mt-12 grid md:grid-cols-[1.3fr_1fr] items-center md:h-[400px]">
            <button onClick={() => setOpen(featured)} className="h-64 md:h-full overflow-hidden" aria-label={`See ${featured.name}`}>
              {featured.images[0] && <img src={featured.images[0]} alt={featured.name} className="w-full h-full object-cover" />}
            </button>
            <div className="p-6 sm:p-10">
              <p className="text-xs tracking-[0.2em] uppercase text-[var(--vs-gold)] mb-3 flex items-center gap-2"><CandlestickChart className="w-4 h-4" /> Gift pick</p>
              <h2 className="vs-display text-3xl sm:text-4xl">{featured.name}</h2>
              {featured.description && <p className="mt-3 text-white/80 line-clamp-3">{featured.description}</p>}
              <p className="mt-4 text-2xl font-bold">{money(featured.priceCents)}</p>
              <button onClick={() => setOpen(featured)} className="vs-btn-solid rounded-full px-6 h-12 font-semibold mt-5">Shop now →</button>
            </div>
          </section>
        )}

        {/* 6. Meet her */}
        <section className="mt-12 rounded-3xl bg-white border border-[var(--vs-line)] p-5 sm:p-8 grid sm:grid-cols-[minmax(0,320px)_1fr] gap-6 sm:gap-10 items-center">
          {t.portrait && <img src={t.portrait} alt={ownerFirst} className="w-full aspect-square sm:aspect-[4/3] object-cover rounded-2xl" />}
          <div>
            <p className="text-xs tracking-[0.25em] uppercase text-[var(--vs-primary)] font-semibold">Meet {ownerFirst}</p>
            <h2 className="vs-display text-4xl sm:text-5xl mt-2">Hi, I’m {ownerFirst}!</h2>
            <p className="text-[var(--vs-muted)] text-lg mt-3 max-w-xl">{t.about || store.tagline}</p>
            {store.instagram && (
              <a href={`https://instagram.com/${store.instagram}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 mt-5 rounded-full px-5 h-11 font-semibold text-white" style={{ background: 'linear-gradient(90deg, #7b2ff7, #e8407a, #f2b33d)' }}>
                <Instagram className="w-5 h-5" /> Follow @{store.instagram}
              </a>
            )}
          </div>
        </section>
      </main>

      {/* 7. Trust strip */}
      <section className="mt-12 border-y border-[var(--vs-line)] bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 grid sm:grid-cols-3 gap-4 text-sm">
          <p className="flex items-center gap-3 sm:justify-center"><ShieldCheck className="w-5 h-5 text-[var(--vs-primary)]" /> Secure checkout by Imagine This Printed</p>
          <p className="flex items-center gap-3 sm:justify-center"><Truck className="w-5 h-5 text-[var(--vs-primary)]" /> Ships to your door</p>
          <p className="flex items-center gap-3 sm:justify-center"><MessageCircle className="w-5 h-5 text-[var(--vs-primary)]" /> Real people answer. <a className="underline text-[var(--vs-primary)]" href={`${ITP_HOME}/contact`}>Contact us</a></p>
        </div>
      </section>

      {/* 8. Footer */}
      <footer className="relative overflow-hidden bg-[var(--vs-ink)] text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 flex flex-col sm:flex-row items-center gap-6 sm:gap-10 text-center sm:text-left">
          {store.logoUrl && <img src={store.logoUrl} alt="" className="w-36 h-36 object-contain" />}
          <div className="sm:border-l sm:border-white/20 sm:pl-10">
            <p className="vs-display text-3xl">{store.name}</p>
            <p className="text-white/70 mt-1">part of <a className="underline" href={ITP_HOME}>Imagine This Printed</a>.</p>
          </div>
        </div>
        <div className="h-1.5" style={{ background: 'var(--vs-rainbow)' }} />
      </footer>

      {open && <ItemSheet item={open} ownerFirst={ownerFirst} onClose={() => setOpen(null)} onAdd={line => { cart.add(line); setOpen(null); setCartOpen(true) }} />}
      {cartOpen && <CartDrawer slug={slug} store={store} byId={byId} cart={cart} onClose={() => setCartOpen(false)} />}
    </div>
  )
}

function ItemSheet({ item, ownerFirst, onClose, onAdd }: {
  item: StoreItem
  ownerFirst: string
  onClose: () => void
  onAdd: (line: CartLine) => void
}) {
  const [img, setImg] = useState(0)
  const [size, setSize] = useState<string | undefined>()
  const [color, setColor] = useState<string | undefined>(item.colors.length === 1 ? item.colors[0] : undefined)
  const [qty, setQty] = useState(1)
  const isStand = item.lineType === 'qr-stand'
  const [stand, setStand] = useState<StandChoice>({ ready: false, personalization: {} })
  const needsSize = item.sizes.length > 0 && !size
  const needsColor = item.colors.length > 1 && !color
  const needsStand = isStand && !stand.ready
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  return (
    <>
      <div className="vs-scrim" onClick={onClose} />
      <div className="vs-sheet grid md:grid-cols-2" role="dialog" aria-label={item.name}>
        <div className="bg-[#f1ebf6]">
          {item.images[img] && <img src={item.images[img]} alt={item.name} className="w-full aspect-square object-cover" />}
          {item.images.length > 1 && (
            <div className="flex gap-2 p-3 overflow-x-auto">
              {item.images.map((src, i) => (
                <button key={src} onClick={() => setImg(i)} className={`w-16 h-16 rounded-lg overflow-hidden border-2 ${i === img ? 'border-[var(--vs-primary)]' : 'border-transparent'}`}>
                  <img src={src} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="p-5 sm:p-7 flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <span className={`vs-tag ${item.kind === 'own' ? 'vs-tag-own' : 'vs-tag-itp'}`}>{item.kind === 'own' ? `Made by ${ownerFirst}` : 'Made by Imagine This Printed'}</span>
            <button className="ml-auto -mt-1" onClick={onClose} aria-label="Close"><X className="w-6 h-6" /></button>
          </div>
          <h3 className="vs-display text-3xl leading-tight">{item.name}</h3>
          <p className="text-2xl font-bold text-[var(--vs-primary)]">{money(item.priceCents)}</p>
          {item.description && <p className="text-[var(--vs-muted)] whitespace-pre-line">{item.description}</p>}
          {item.sizes.length > 0 && (
            <div>
              <p className="text-sm font-semibold mb-2">Size</p>
              <div className="flex flex-wrap gap-2">
                {item.sizes.map(s => (
                  <button key={s} aria-pressed={size === s} onClick={() => setSize(s)} className="vs-size min-w-12 h-10 px-3 rounded-lg border border-[var(--vs-line)] font-medium">{s}</button>
                ))}
              </div>
              {item.kind === 'itp' && <p className="text-xs text-[var(--vs-muted)] mt-2">2XL and up cost a little more.</p>}
            </div>
          )}
          {isStand && <StoreStandFields onChange={setStand} />}
          {item.colors.length > 1 && (
            <div>
              <p className="text-sm font-semibold mb-2">Colour</p>
              <div className="flex flex-wrap gap-2">
                {item.colors.map(c => (
                  <button key={c} aria-pressed={color === c} onClick={() => setColor(c)} className="vs-size h-10 px-3 rounded-lg border border-[var(--vs-line)] font-medium">{c}</button>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center gap-3 sticky bottom-0 -mx-5 sm:-mx-7 px-5 sm:px-7 py-3 bg-white border-t border-[var(--vs-line)] md:static md:m-0 md:p-0 md:border-0">
            <div className="flex items-center rounded-xl border border-[var(--vs-line)]">
              <button className="w-10 h-10 grid place-items-center" onClick={() => setQty(Math.max(1, qty - 1))} aria-label="One less"><Minus className="w-4 h-4" /></button>
              <span className="w-8 text-center font-semibold">{qty}</span>
              <button className="w-10 h-10 grid place-items-center" onClick={() => setQty(Math.min(20, qty + 1))} aria-label="One more"><Plus className="w-4 h-4" /></button>
            </div>
            <button
              disabled={needsSize || needsColor || needsStand}
              onClick={() => onAdd({ itemId: item.id, quantity: qty, size, color, ...(isStand ? { personalization: stand.personalization } : {}) })}
              className="vs-btn-pink flex-1 rounded-xl h-12 font-semibold flex items-center justify-center gap-2"
            >
              <ShoppingCart className="w-5 h-5" /> {needsSize ? 'Pick a size' : needsColor ? 'Pick a colour' : needsStand ? 'Add your link' : 'Add to cart'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

/** The buyer's ship-to, remembered on this device for the next visit (never sent anywhere until they check out). */
function useShipTo(slug: string) {
  const key = `vstore-shipto:${slug}`
  const [shipTo, setShipTo] = useState<ShipAddress>(() => {
    try {
      return { ...emptyAddress(), ...JSON.parse(localStorage.getItem(key) || '{}') }
    } catch {
      return emptyAddress()
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(shipTo))
    } catch {
      /* private mode: the address still works for this visit */
    }
  }, [key, shipTo])
  return [shipTo, setShipTo] as const
}

function CartDrawer({ slug, store, byId, cart, onClose }: {
  slug: string
  store: StoreInfo
  byId: Map<string, StoreItem>
  cart: ReturnType<typeof useStoreCart>
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [shipTo, setShipTo] = useShipTo(slug)
  // Shipping is priced for this cart and this address (real carrier rates); any change prices it again.
  const [quote, setQuote] = useState<{ state: 'idle' | 'loading' | 'ready' | 'error'; options: ShippingOption[]; startedAt: number; error?: string }>({ state: 'idle', options: [], startedAt: 0 })
  const [picked, setPicked] = useState<string | null>(null)
  const [requote, setRequote] = useState(0)
  // A line whose item came off the store since it was added is dropped from the total and the checkout.
  const lines = cart.lines.map((l, index) => ({ ...l, index, item: byId.get(l.itemId) })).filter(l => l.item)
  const subtotal = lines.reduce((n, l) => n + l.item!.priceCents * l.quantity, 0)
  const cartLines = lines.map(({ itemId, quantity, size, color, personalization }) => ({ itemId, quantity, size, color, personalization }))
  const cartKey = JSON.stringify(cartLines)
  const ready = addressReady(shipTo)
  const addressKey = JSON.stringify({ ...shipTo, phone: '' })
  const option = quote.options.find(o => o.id === picked) || null
  const wanted = useRef(picked)
  wanted.current = picked

  useEffect(() => {
    if (!ready || !cartLines.length) {
      setQuote({ state: 'idle', options: [], startedAt: 0 })
      return
    }
    let alive = true
    const timer = setTimeout(() => {
      setQuote(q => ({ state: 'loading', options: q.options, startedAt: Date.now() }))
      quoteShipping(slug, cartLines, shipTo)
        .then(options => {
          if (!alive) return
          setQuote({ state: 'ready', options, startedAt: 0 })
          // Keep the buyer's pick when it is still offered; otherwise the cheapest.
          setPicked(options.some(o => o.id === wanted.current) ? wanted.current : options[0]?.id ?? null)
        })
        .catch(e => alive && setQuote({ state: 'error', options: [], startedAt: 0, error: e.message }))
    }, 500)
    return () => { alive = false; clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, cartKey, addressKey, ready, requote])

  const checkout = async () => {
    if (!option) return
    setBusy(true)
    setError('')
    try {
      window.location.href = await startCheckout(slug, cartLines, shipTo, option.token)
    } catch (e: any) {
      setError(e.message)
      setBusy(false)
      // A price that went stale (15 minutes) or a cart that changed is priced again right away.
      if (/Pick a shipping option again/.test(e.message)) setRequote(n => n + 1)
    }
  }

  const days = (o: ShippingOption) => (o.days <= 1 ? 'about 1 business day' : `about ${o.days} business days`)

  return (
    <>
      <div className="vs-scrim" onClick={onClose} />
      <aside className="vs-drawer" aria-label="Cart">
        <div className="flex items-center gap-3 px-5 h-16 border-b border-[var(--vs-line)]">
          <ShoppingCart className="w-5 h-5 text-[var(--vs-primary)]" />
          <p className="vs-display text-2xl">Your cart</p>
          <button className="ml-auto" onClick={onClose} aria-label="Close cart"><X className="w-6 h-6" /></button>
        </div>
        <div className="flex-1 overflow-auto p-5 flex flex-col gap-4">
          {lines.length === 0 && <p className="text-[var(--vs-muted)] text-center mt-10">Your cart is empty.</p>}
          {lines.map(l => (
            <div key={`${l.itemId}-${l.size}-${l.color}-${l.index}`} className="flex gap-3">
              {l.item!.images[0] && <img src={l.item!.images[0]} alt="" className="w-20 h-20 rounded-xl object-cover bg-[#f1ebf6]" />}
              <div className="flex-1 min-w-0">
                <p className="font-medium leading-snug">{l.item!.name}</p>
                <p className="text-sm text-[var(--vs-muted)] break-all">{[l.size, l.color, l.personalization?.qr_caption, l.personalization?.qr_link?.replace(/^https?:\/\//, '')].filter(Boolean).join(' · ')}</p>
                <div className="flex items-center gap-2 mt-1">
                  <button className="w-7 h-7 rounded-lg border border-[var(--vs-line)] grid place-items-center" onClick={() => cart.setQty(l.index, l.quantity - 1)} aria-label="One less"><Minus className="w-3 h-3" /></button>
                  <span className="w-6 text-center text-sm font-semibold">{l.quantity}</span>
                  <button className="w-7 h-7 rounded-lg border border-[var(--vs-line)] grid place-items-center" onClick={() => cart.setQty(l.index, l.quantity + 1)} aria-label="One more"><Plus className="w-3 h-3" /></button>
                  <button className="ml-auto text-[var(--vs-muted)]" onClick={() => cart.setQty(l.index, 0)} aria-label="Remove"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
              <p className="font-semibold">{money(l.item!.priceCents * l.quantity)}</p>
            </div>
          ))}

          {lines.length > 0 && (
            <section className="rounded-2xl border border-[var(--vs-line)] p-4 flex flex-col gap-3" aria-label="Shipping">
              <p className="font-semibold flex items-center gap-2"><Truck className="w-5 h-5 text-[var(--vs-primary)]" /> Ship to</p>
              <StoreAddressFields value={shipTo} onChange={setShipTo} section="shipping" phoneLabel="Phone (optional, for the carrier)" />
              {!ready && <p className="text-xs text-[var(--vs-muted)]">Add your address to see shipping prices.</p>}
              {quote.state === 'loading' && quote.options.length === 0 && (
                <ProgressBar label="Finding shipping prices" startedAt={quote.startedAt} expectedMs={2500} />
              )}
              {quote.state === 'error' && (
                <p className="text-sm text-red-600">{quote.error} <button className="underline" onClick={() => setRequote(n => n + 1)}>Try again</button></p>
              )}
              {quote.options.length > 0 && (
                <div className={`flex flex-col gap-2 ${quote.state === 'loading' ? 'opacity-60' : ''}`} role="radiogroup" aria-label="Shipping speed">
                  {quote.options.map(o => (
                    <button key={o.id} role="radio" aria-checked={o.id === picked} onClick={() => setPicked(o.id)}
                      className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${o.id === picked ? 'border-[var(--vs-primary)] bg-[var(--vs-page)]' : 'border-[var(--vs-line)] hover:border-[var(--vs-primary)]'}`}>
                      <span className={`w-4 h-4 rounded-full border-2 shrink-0 ${o.id === picked ? 'border-[var(--vs-primary)] bg-[var(--vs-primary)] shadow-[inset_0_0_0_3px_var(--vs-card)]' : 'border-[var(--vs-line)]'}`} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium">{o.name}</span>
                        <span className="block text-xs text-[var(--vs-muted)]">{days(o)}{o.packages > 1 ? ' · ships in 2 packages' : ''}</span>
                      </span>
                      <span className="font-semibold text-sm">{money(o.amountCents)}</span>
                    </button>
                  ))}
                </div>
              )}
              {option && option.packages > 1 && (
                <p className="text-xs text-[var(--vs-muted)]">Things {store.theme?.ownerFirst || 'she'} makes ship from her, and Imagine This Printed items ship from our shop, so they come in two boxes.</p>
              )}
            </section>
          )}
        </div>
        <div className="border-t border-[var(--vs-line)] p-5 flex flex-col gap-2">
          <div className="flex justify-between text-sm"><span>Subtotal</span><span>{money(subtotal)}</span></div>
          <div className="flex justify-between text-sm"><span>Shipping</span><span>{option ? money(option.amountCents) : <span className="text-[var(--vs-muted)]">{ready ? '…' : 'Add your address'}</span>}</span></div>
          <div className="flex justify-between font-semibold text-lg"><span>Total</span><span>{money(subtotal + (option?.amountCents ?? 0))}</span></div>
          <p className="text-xs text-[var(--vs-muted)]">2XL and up on Imagine This Printed shirts cost a little more.</p>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            disabled={!lines.length || busy || !store.open || !option || quote.state === 'loading'}
            onClick={checkout}
            className="vs-btn-pink rounded-xl h-12 font-semibold flex items-center justify-center gap-2"
          >
            <Lock className="w-4 h-4" /> {!store.open ? 'Checkout opens soon' : busy ? 'Opening checkout…' : option ? 'Check out securely' : 'Add your address to check out'}
          </button>
          <p className="text-[11px] text-center text-[var(--vs-muted)]">Secure checkout by Imagine This Printed</p>
        </div>
      </aside>
    </>
  )
}
