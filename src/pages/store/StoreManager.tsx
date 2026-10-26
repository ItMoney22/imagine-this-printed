// Where a seller runs her store (imaginethisprinted.com/vendor/store/<slug>), and where ITP admins
// set ITP's side: the fee, shipping, status, owner and the ITP products she may sell at the price
// David sets. Built to David's approved mock (page_mockup_approvals 39ec4916, 2026-10-26).
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, BadgeCheck, Boxes, CircleDollarSign, ExternalLink, Home, ImagePlus, Instagram, Lock, Mail, Package, Palette, Search, Settings, Shirt, ShoppingCart, Sparkles, Trash2, Wallet } from 'lucide-react'
import { money, vendorStoreApi, type ManageData, type ManageItem } from '../../lib/vendor-store'
import StoreCredits from './StoreCredits'
import StoreAssistant from './StoreAssistant'
import StoreDesign from './StoreDesign'
import StoreInbox from './StoreInbox'
import './store.css'

const SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL']
const COLOURS: Array<[string, string]> = [
  ['Black', '#111'], ['White', '#fff'], ['Gray', '#8a8a8a'], ['Red', '#e53935'], ['Purple', '#7b2fbe'],
  ['Blue', '#1e88e5'], ['Green', '#06af58'], ['Yellow', '#f2c12e'], ['Pink', '#e8407a'],
]
const dollars = (v: string) => Math.round(Number(v.replace(/[^0-9.]/g, '')) * 100)

export default function StoreManager() {
  const { slug = '' } = useParams()
  const [search, setSearch] = useSearchParams()
  const [data, setData] = useState<ManageData | null>(null)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [unread, setUnread] = useState(0)
  // Create a design opens in place (and stays open while a design is being built: ?productId= is in the address).
  const [designOpen, setDesignOpen] = useState(() => !!new URLSearchParams(window.location.search).get('productId'))
  const openDesign = () => {
    setDesignOpen(true)
    setTimeout(() => document.getElementById('design')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }
  // The assistant sits docked beside the page on a wide screen; on a phone it opens from the floating button.
  const wide = () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1280px)').matches
  const [assistantOpen, setAssistantOpen] = useState(wide)
  // The assistant's Make it a product: her design is in the Step Flow, so Create a design opens on it (the phone's
  // assistant sheet steps aside so she sees it).
  const openDesignOn = (productId: string) => {
    const next = new URLSearchParams(search)
    next.set('productId', productId)
    setSearch(next)
    if (!wide()) setAssistantOpen(false)
    openDesign()
  }

  const load = useCallback(() => {
    vendorStoreApi.load(slug).then(setData).catch(e => setError(/403/.test(e.message) ? 'This isn’t your store.' : /404/.test(e.message) ? 'No store here.' : 'The store didn’t load.'))
  }, [slug])
  useEffect(load, [load])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 2600)
    return () => clearTimeout(t)
  }, [toast])

  const save = async (fn: () => Promise<unknown>, done = 'Saved') => {
    try {
      await fn()
      setToast(done)
      load()
    } catch (e: any) {
      setToast(String(e.message).replace(/^HTTP \d+: /, '').replace(/^\{"error":"(.*)"\}$/, '$1'))
    }
  }

  const stats = useMemo(() => {
    if (!data) return null
    const month = new Date().toISOString().slice(0, 7)
    const thisMonth = data.orders.filter(o => o.createdAt.startsWith(month))
    return {
      sales: thisMonth.reduce((n, o) => n + o.totalCents, 0),
      earnings: thisMonth.reduce((n, o) => n + (o.yourShareCents || 0), 0),
      toShip: data.orders.filter(o => o.fulfillment === 'unfulfilled' && o.items.some(i => i.maker === 'vendor')).length,
      live: data.items.filter(i => i.active).length,
    }
  }, [data])

  if (error) return <div className="vstore grid place-items-center text-center px-6"><p className="vs-display text-3xl">{error}</p></div>
  if (!data || !stats) return <div className="vstore grid place-items-center"><div className="w-10 h-10 rounded-full border-2 border-[var(--vs-primary)] border-t-transparent animate-spin" /></div>

  const { store, payouts } = data
  // An admin can see exactly what the seller sees (?view=seller): no admin panel.
  const asSeller = search.get('view') === 'seller'
  const isAdmin = data.isAdmin && !asSeller
  const t = store.theme || {}
  const rootStyle = { ...(t.primary ? { '--vs-primary': t.primary } : {}), ...(t.green ? { '--vs-green': t.green } : {}), ...(t.pink ? { '--vs-pink': t.pink } : {}), ...(t.gold ? { '--vs-gold': t.gold } : {}) } as CSSProperties
  const own = data.items.filter(i => i.kind === 'own')
  const ours = data.items.filter(i => i.kind === 'itp')
  const nav = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'products', label: 'Products', icon: Shirt },
    { id: 'orders', label: 'Orders', icon: Package },
    { id: 'inbox', label: 'Inbox', icon: Mail, count: unread },
    { id: 'credits', label: 'Credits', icon: Sparkles },
    { id: 'design', label: 'Create a design', icon: Palette },
    { id: 'payouts', label: 'Payouts', icon: Wallet },
    { id: 'settings', label: 'Settings', icon: Settings },
  ]

  return (
    <div className="vstore" style={rootStyle}>
      {/* 1. Header band */}
      <header className="vs-bar" id="home">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center gap-3">
          {store.logoUrl && <img src={store.logoUrl} alt="" className="h-12 w-12 object-contain" />}
          <h1 className="vs-display text-white text-2xl sm:text-4xl">Your store</h1>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <a href={store.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-white/40 text-white text-sm px-4 h-10 hover:bg-white/10">View my store <ExternalLink className="w-4 h-4" /></a>
            <span className={`inline-flex items-center gap-2 rounded-full text-sm px-4 h-10 font-semibold ${store.status === 'live' ? 'bg-[var(--vs-green)]/20 text-white border border-[var(--vs-green)]' : 'bg-white/10 text-white/90 border border-white/30'}`}>
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: store.status === 'live' ? 'var(--vs-green)' : 'var(--vs-gold)' }} />
              {store.status === 'live' ? 'Live' : store.status === 'paused' ? 'Paused' : 'Draft'}
            </span>
            <a href="#payouts" className="inline-flex items-center gap-2 rounded-xl bg-white text-[var(--vs-text)] text-sm px-4 h-10 font-semibold shadow">
              {payouts.ready ? <><BadgeCheck className="w-5 h-5 text-[var(--vs-green)]" /> Payouts ready</> : <><Wallet className="w-5 h-5 text-[var(--vs-primary)]" /> Set up payouts</>}
            </a>
          </div>
        </div>
      </header>

      {data.isAdmin && (
        <div className="bg-[var(--vs-ink)] text-white text-sm">
          <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-2 flex items-center gap-3">
            <Lock className="w-4 h-4 text-[var(--vs-gold)]" />
            {asSeller ? 'You’re seeing exactly what the seller sees.' : 'You’re signed in as an admin: the admin panel is at the bottom.'}
            <Link className="ml-auto underline" to={asSeller ? `/vendor/store/${slug}` : `/vendor/store/${slug}?view=seller`}>
              {asSeller ? 'Back to admin view' : 'See it as the seller'}
            </Link>
          </div>
        </div>
      )}

      {search.get('payouts') === 'done' && !payouts.ready && (
        <p className="bg-[var(--vs-gold)]/20 text-center text-sm py-2">Thanks! Stripe is checking your details. This page shows Payouts ready once it’s done.</p>
      )}

      <div className={`mx-auto px-4 sm:px-6 py-6 lg:grid gap-6 ${assistantOpen ? 'max-w-[1700px] lg:grid-cols-[190px_1fr] xl:grid-cols-[190px_1fr_360px]' : 'max-w-[1400px] lg:grid-cols-[190px_1fr]'}`}>
        {/* Side menu (a pill row on a phone) */}
        <nav className="lg:sticky lg:top-24 self-start flex lg:flex-col gap-2 overflow-x-auto pb-3 lg:pb-0 mb-4 lg:mb-0">
          {nav.map(n => {
            const Icon = n.icon
            return (
              <a key={n.id} href={`#${n.id}`} className="flex items-center gap-3 rounded-xl px-4 h-11 shrink-0 font-medium hover:bg-white text-[var(--vs-text)]">
                <Icon className="w-5 h-5 text-[var(--vs-primary)]" /> {n.label}
                {!!n.count && <span className="ml-auto min-w-6 h-6 px-1.5 rounded-full grid place-items-center text-xs font-semibold text-white bg-[var(--vs-pink)]">{n.count}</span>}
              </a>
            )
          })}
          <Link to="/" className="flex items-center gap-2 rounded-xl px-4 h-11 shrink-0 text-sm text-[var(--vs-muted)] hover:bg-white lg:mt-4"><ArrowLeft className="w-4 h-4" /> Imagine This Printed</Link>
        </nav>

        <main className="flex flex-col gap-6 min-w-0">
          {/* 2. Stats */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-5">
            <Stat icon={ShoppingCart} colour="var(--vs-pink)" label="Sales this month" value={money(stats.sales)} />
            <Stat icon={CircleDollarSign} colour="var(--vs-green)" label="Your earnings" value={money(stats.earnings)} />
            <Stat icon={Boxes} colour="var(--vs-primary)" label="Orders to ship" value={String(stats.toShip)} />
            <Stat icon={Shirt} colour="var(--vs-gold)" label="Items for sale" value={String(stats.live)} />
          </div>

          {/* Her ITC credits and the AI tools they pay for */}
          <StoreCredits slug={slug} onDesign={openDesign} />

          {/* Create a design: the Step Flow, right here on her page */}
          <StoreDesign open={designOpen} onOpen={openDesign} />

          {/* 3. Add a product */}
          <AddProduct slug={slug} feePercent={store.feePercent} onSaved={() => { setToast('Added to your store'); load() }} onError={setToast} />

          {/* 4. Her products */}
          <Card id="products" icon={Shirt} title="Your products">
            {own.length === 0 ? <p className="text-[var(--vs-muted)]">Nothing yet. Add your first product above.</p> : (
              <div className="grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
                {own.map(i => (
                  <div key={i.id} className="rounded-2xl border border-[var(--vs-line)] p-3 flex flex-col gap-2">
                    <div className="relative">
                      {i.images[0] && <img src={i.images[0]} alt="" className="w-full aspect-square object-cover rounded-xl" />}
                      <Switch className="absolute top-2 right-2" on={i.active} label={`${i.name} for sale`} onChange={v => save(() => vendorStoreApi.saveItem(slug, i.id, { active: v }), v ? 'For sale' : 'Taken off the store')} />
                    </div>
                    <p className="font-medium leading-snug">{i.name}</p>
                    <PriceBox cents={i.priceCents} onSave={c => save(() => vendorStoreApi.saveItem(slug, i.id, { priceCents: c }), 'Price saved')} />
                    <button className="self-start flex items-center gap-1 text-sm text-[var(--vs-pink)]" onClick={() => window.confirm(`Delete ${i.name}?`) && save(() => vendorStoreApi.deleteItem(slug, i.id), 'Deleted')}>
                      <Trash2 className="w-4 h-4" /> Delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* 5. ITP products she can sell */}
          <Card icon={Lock} title="Imagine This Printed products you can sell">
            {ours.length === 0 ? <p className="text-[var(--vs-muted)]">None offered yet. Imagine This Printed adds them here with your price.</p> : (
              <div className="grid lg:grid-cols-2 gap-4">
                {ours.map(i => <ItpOffer key={i.id} item={i} onSave={(patch, done) => save(() => vendorStoreApi.saveItem(slug, i.id, patch), done)} />)}
              </div>
            )}
          </Card>

          {/* Her store email, junk kept out */}
          <StoreInbox slug={slug} onUnread={setUnread} onToast={setToast} />

          {/* 6. Orders */}
          <Card id="orders" icon={Package} title="Orders">
            {data.orders.length === 0 ? <p className="text-[var(--vs-muted)]">No orders yet. They show up here the moment someone pays.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead className="text-left text-[var(--vs-muted)]">
                    <tr><th className="py-2">Order</th><th>Buyer</th><th>What you ship</th><th>What we ship</th><th className="text-right">Your share</th></tr>
                  </thead>
                  <tbody>
                    {data.orders.map(o => (
                      <tr key={o.orderNumber} className="border-t border-[var(--vs-line)] align-top">
                        <td className="py-3 font-medium">{o.orderNumber}<div className="text-xs text-[var(--vs-muted)]">{new Date(o.createdAt).toLocaleDateString()}</div></td>
                        <td className="py-3">{o.customer || '—'}</td>
                        <td className="py-3"><Tags items={o.items.filter(i => i.maker === 'vendor')} cls="vs-tag-own" /></td>
                        <td className="py-3"><Tags items={o.items.filter(i => i.maker === 'itp')} cls="vs-tag-itp" /></td>
                        <td className="py-3 text-right font-semibold">{o.yourShareCents != null ? money(o.yourShareCents) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Payouts */}
          <Card id="payouts" icon={Wallet} title="Payouts">
            {payouts.ready ? (
              <p className="flex items-center gap-2"><BadgeCheck className="w-5 h-5 text-[var(--vs-green)]" /> Payouts are ready. Stripe sends your share of every sale straight to your bank.</p>
            ) : (
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <p className="text-[var(--vs-muted)] flex-1">
                  {payouts.detailsSubmitted ? 'Stripe is checking your details.' : 'Tell Stripe where to send your money. It takes about five minutes on Stripe’s own secure page.'} Your store takes orders once this is done.
                </p>
                <button className="vs-btn-solid rounded-full px-6 h-12 font-semibold" onClick={() => save(async () => { window.location.href = (await vendorStoreApi.payoutsLink(slug)).url }, 'Opening Stripe…')}>
                  {payouts.hasAccount ? 'Finish payouts setup' : 'Set up payouts'}
                </button>
              </div>
            )}
          </Card>

          {/* Her settings */}
          <SellerSettings data={data} slug={slug} save={save} />

          {/* 7. Admin only */}
          {isAdmin && <AdminPanel data={data} slug={slug} save={save} />}
        </main>

        <StoreAssistant slug={slug} ownerFirst={t.ownerFirst || store.name.split(/[’']/)[0]} faceUrl={t.assistant} open={assistantOpen} onClose={() => setAssistantOpen(false)}
          onMakeProduct={openDesignOn} onNeedStudio={openDesign} />
      </div>

      {!assistantOpen && (
        <button className="vs-fab" onClick={() => setAssistantOpen(true)} aria-label="Open your store assistant"><Sparkles className="w-7 h-7" /></button>
      )}

      {toast && <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-full bg-[var(--vs-ink)] text-white px-5 py-3 shadow-xl text-sm">{toast}</div>}
    </div>
  )
}

/** /vendor/store: open the signed-in seller's store (or the list, for an admin). */
export function MyStoreRedirect() {
  const [stores, setStores] = useState<Array<{ slug: string; name: string }> | null>(null)
  useEffect(() => { vendorStoreApi.mine().then(r => setStores(r.stores)).catch(() => setStores([])) }, [])
  if (!stores) return <div className="vstore grid place-items-center"><div className="w-10 h-10 rounded-full border-2 border-[var(--vs-primary)] border-t-transparent animate-spin" /></div>
  if (stores.length === 1) return <Navigate to={`/vendor/store/${stores[0].slug}`} replace />
  return (
    <div className="vstore px-6 py-16 max-w-xl mx-auto">
      <h1 className="vs-display text-4xl mb-6">Stores</h1>
      {stores.length === 0 ? <p className="text-[var(--vs-muted)]">You don’t have a store yet.</p> : stores.map(s => (
        <Link key={s.slug} to={`/vendor/store/${s.slug}`} className="block rounded-2xl bg-white border border-[var(--vs-line)] p-4 mb-3 font-medium">{s.name}</Link>
      ))}
    </div>
  )
}

function Stat({ icon: Icon, colour, label, value }: { icon: typeof Home; colour: string; label: string; value: string }) {
  return (
    <div className="vs-card p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <span className="w-11 h-11 rounded-full grid place-items-center text-white shrink-0" style={{ background: colour }}><Icon className="w-5 h-5" /></span>
        <span className="text-sm text-[var(--vs-muted)]">{label}</span>
      </div>
      <p className="vs-display text-3xl sm:text-4xl mt-3">{value}</p>
    </div>
  )
}

function Card({ id, icon: Icon, title, children }: { id?: string; icon: typeof Home; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="rounded-3xl bg-white border border-[var(--vs-line)] p-4 sm:p-6 scroll-mt-28">
      <h2 className="vs-display text-2xl sm:text-3xl flex items-center gap-3 mb-5">
        <span className="w-10 h-10 rounded-full grid place-items-center text-white" style={{ background: 'var(--vs-primary)' }}><Icon className="w-5 h-5" /></span>
        {title}
      </h2>
      {children}
    </section>
  )
}

function Switch({ on, onChange, label, className = '' }: { on: boolean; onChange: (v: boolean) => void; label: string; className?: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={`w-12 h-7 rounded-full p-1 transition-colors ${on ? 'bg-[var(--vs-green)]' : 'bg-gray-300'} ${className}`}>
      <span className={`block w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : ''}`} />
    </button>
  )
}

function PriceBox({ cents, onSave }: { cents: number; onSave: (cents: number) => void }) {
  const [v, setV] = useState((cents / 100).toFixed(2))
  useEffect(() => setV((cents / 100).toFixed(2)), [cents])
  const commit = () => { const c = dollars(v); if (c !== cents && c >= 100) onSave(c); else setV((cents / 100).toFixed(2)) }
  return (
    <label className="flex items-center rounded-xl border border-[var(--vs-line)] px-3 h-10 focus-within:border-[var(--vs-primary)]">
      <span className="text-[var(--vs-muted)]">$</span>
      <input inputMode="decimal" className="w-full outline-none px-1 bg-transparent" value={v} onChange={e => setV(e.target.value)} onBlur={commit} onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} aria-label="Price" />
    </label>
  )
}

function Tags({ items, cls }: { items: Array<{ name: string; quantity: number; size?: string }>; cls: string }) {
  if (!items.length) return <span className="text-[var(--vs-muted)]">—</span>
  return <div className="flex flex-wrap gap-1">{items.map((i, n) => <span key={n} className={`vs-tag ${cls}`}>{i.quantity} × {i.name}{i.size ? ` (${i.size})` : ''}</span>)}</div>
}

function ItpOffer({ item, onSave }: { item: ManageItem; onSave: (patch: Record<string, unknown>, done: string) => void }) {
  const [price, setPrice] = useState((item.priceCents / 100).toFixed(2))
  useEffect(() => setPrice((item.priceCents / 100).toFixed(2)), [item.priceCents])
  const typed = dollars(price)
  const earn = Number.isFinite(typed) ? typed - item.itpCostCents : 0
  const suggested = item.suggestedPriceCents
  return (
    <div className="rounded-2xl border border-[var(--vs-line)] p-3 grid grid-cols-[120px_1fr] sm:grid-cols-[160px_1fr] gap-4">
      {item.images[0] ? <img src={item.images[0]} alt="" className="w-full aspect-square object-cover rounded-xl" /> : <div />}
      <div className="flex flex-col gap-2 text-sm">
        <p className="font-semibold text-base leading-snug">{item.name}</p>
        <p className="flex justify-between"><span className="text-[var(--vs-muted)]">Our price to you</span><span className="font-semibold text-[var(--vs-primary)]">{money(item.itpCostCents)}</span></p>
        {suggested != null && suggested > 0 && (
          <p className="flex items-center justify-between gap-2">
            <span className="text-[var(--vs-muted)]">Suggested price</span>
            <span className="flex items-center gap-2">
              <span className="font-semibold">{money(suggested)}</span>
              {suggested !== item.priceCents && (
                <button className="text-xs font-semibold text-[var(--vs-pink)] underline" onClick={() => onSave({ priceCents: suggested }, 'Using the suggested price')}>Use it</button>
              )}
            </span>
          </p>
        )}
        <label className="flex items-center justify-between gap-3"><span className="text-[var(--vs-muted)]">Your price</span>
          <span className="flex items-center rounded-xl border border-[var(--vs-line)] px-3 h-9 w-28 focus-within:border-[var(--vs-primary)]">$
            <input inputMode="decimal" className="w-full outline-none px-1" value={price} onChange={e => setPrice(e.target.value)} aria-label={`Your price for ${item.name}`}
              onBlur={() => typed !== item.priceCents && (typed >= item.itpCostCents ? onSave({ priceCents: typed }, 'Price saved') : setPrice((item.priceCents / 100).toFixed(2)))} />
          </span>
        </label>
        <div className="flex items-center justify-between mt-1">
          <span>You earn <strong className="text-[var(--vs-green)] text-lg">{money(Math.max(0, earn))}</strong></span>
          <span className="flex items-center gap-2"><Switch on={item.active} label={`Sell ${item.name}`} onChange={v => onSave({ active: v }, v ? 'On your store' : 'Off your store')} /> Sell it</span>
        </div>
      </div>
    </div>
  )
}

function AddProduct({ slug, feePercent, onSaved, onError }: { slug: string; feePercent: number; onSaved: () => void; onError: (m: string) => void }) {
  const [files, setFiles] = useState<File[]>([])
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [sizes, setSizes] = useState<string[]>([])
  const [colours, setColours] = useState<string[]>([])
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const previews = useMemo(() => files.map(f => URL.createObjectURL(f)), [files])
  useEffect(() => () => previews.forEach(URL.revokeObjectURL), [previews])
  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter(x => x !== v) : [...list, v])
  const addFiles = (fl: FileList | null) => fl && setFiles(prev => [...prev, ...Array.from(fl).filter(f => /image\/(png|jpe?g|webp)/.test(f.type))].slice(0, 6))

  const submit = async () => {
    if (!files.length) return onError('Add at least one photo')
    if (!name.trim()) return onError('Give it a name')
    if (!(dollars(price) >= 100)) return onError('Price must be at least $1.00')
    setBusy(true)
    const form = new FormData()
    files.forEach(f => form.append('images', f))
    form.append('name', name.trim())
    form.append('price', String(dollars(price) / 100))
    form.append('sizes', sizes.join(','))
    form.append('colors', colours.join(','))
    form.append('description', description)
    try {
      await vendorStoreApi.addItem(slug, form)
      setFiles([]); setName(''); setPrice(''); setSizes([]); setColours([]); setDescription('')
      onSaved()
    } catch (e: any) {
      onError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card icon={ImagePlus} title="Add a product">
      <div className="grid lg:grid-cols-[minmax(0,300px)_1fr] gap-5">
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => input.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files) }}
            className="rounded-2xl border-2 border-dashed border-[var(--vs-primary)]/40 bg-[var(--vs-page)] min-h-44 grid place-items-center text-center p-4 hover:border-[var(--vs-primary)]"
          >
            {previews.length ? (
              <div className="grid grid-cols-3 gap-2 w-full">{previews.map(p => <img key={p} src={p} alt="" className="aspect-square object-cover rounded-lg" />)}</div>
            ) : (
              <span><ImagePlus className="w-8 h-8 mx-auto text-[var(--vs-primary)]" /><span className="block font-medium mt-2">Drop your photos here</span><span className="block text-xs text-[var(--vs-muted)]">or click to browse · JPG, PNG or WEBP</span></span>
            )}
          </button>
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={e => addFiles(e.target.files)} />
          <button disabled={busy} onClick={submit} className="vs-btn-pink rounded-xl h-12 font-semibold">{busy ? 'Saving…' : 'Save'}</button>
          <p className="text-xs text-[var(--vs-muted)]">You make and ship these. Imagine This Printed keeps {feePercent} percent.</p>
        </div>
        <div className="grid sm:grid-cols-[1fr_140px] gap-4 content-start">
          <label className="text-sm font-medium">Product name
            <input className="mt-1 w-full rounded-xl border border-[var(--vs-line)] px-3 h-11 outline-none focus:border-[var(--vs-primary)]" placeholder="Eg. Craft Queen T-shirt" value={name} onChange={e => setName(e.target.value)} />
          </label>
          <label className="text-sm font-medium">Price
            <span className="mt-1 flex items-center rounded-xl border border-[var(--vs-line)] px-3 h-11 focus-within:border-[var(--vs-primary)]">$<input inputMode="decimal" className="w-full outline-none px-1" placeholder="0.00" value={price} onChange={e => setPrice(e.target.value)} /></span>
          </label>
          <div className="sm:col-span-2">
            <p className="text-sm font-medium mb-2">Sizes <span className="text-[var(--vs-muted)] font-normal">(skip for one-size items)</span></p>
            <div className="flex flex-wrap gap-2">{SIZES.map(s => <button key={s} aria-pressed={sizes.includes(s)} onClick={() => toggle(sizes, setSizes, s)} className="vs-size h-9 min-w-11 px-3 rounded-lg border border-[var(--vs-line)] text-sm">{s}</button>)}</div>
          </div>
          <div className="sm:col-span-2">
            <p className="text-sm font-medium mb-2">Colours <span className="text-[var(--vs-muted)] font-normal">(the ones buyers can pick)</span></p>
            <div className="flex flex-wrap gap-2">
              {COLOURS.map(([c, hex]) => (
                <button key={c} title={c} aria-label={c} aria-pressed={colours.includes(c)} onClick={() => toggle(colours, setColours, c)}
                  className={`w-8 h-8 rounded-full border ${colours.includes(c) ? 'ring-2 ring-offset-2 ring-[var(--vs-primary)]' : 'border-gray-300'}`} style={{ background: hex }} />
              ))}
            </div>
          </div>
          <label className="sm:col-span-2 text-sm font-medium">Short description
            <textarea maxLength={500} rows={3} className="mt-1 w-full rounded-xl border border-[var(--vs-line)] px-3 py-2 outline-none focus:border-[var(--vs-primary)]" placeholder="Tell buyers about it…" value={description} onChange={e => setDescription(e.target.value)} />
            <span className="block text-right text-xs text-[var(--vs-muted)]">{description.length}/500</span>
          </label>
        </div>
      </div>
    </Card>
  )
}

function SellerSettings({ data, slug, save }: { data: ManageData; slug: string; save: (fn: () => Promise<unknown>, done?: string) => void }) {
  const { store } = data
  const [ig, setIg] = useState(store.instagram ? `@${store.instagram}` : '')
  const [tagline, setTagline] = useState(store.tagline || '')
  const [ship, setShip] = useState((store.ownShippingCents / 100).toFixed(2))
  const igNow = store.instagram ? `@${store.instagram}` : ''
  return (
    <Card id="settings" icon={Settings} title="Settings">
      <div className="grid md:grid-cols-3 gap-4 text-sm">
        <label className="font-medium">Instagram
          <span className="mt-1 flex items-center gap-2 rounded-xl border border-[var(--vs-line)] px-3 h-11 focus-within:border-[var(--vs-primary)]">
            <Instagram className="w-5 h-5 text-[var(--vs-pink)]" />
            <input className="w-full outline-none" placeholder="@yourhandle" value={ig} onChange={e => setIg(e.target.value)}
              onBlur={() => ig.trim() !== igNow && save(() => vendorStoreApi.saveStore(slug, { instagram: ig }), 'Instagram saved')} />
          </span>
          <span className="block text-xs text-[var(--vs-muted)] font-normal mt-1">Shows on your store.</span>
        </label>
        <label className="font-medium">Store tagline
          <input maxLength={140} className="mt-1 w-full rounded-xl border border-[var(--vs-line)] px-3 h-11 outline-none focus:border-[var(--vs-primary)]" value={tagline} onChange={e => setTagline(e.target.value)}
            onBlur={() => tagline !== (store.tagline || '') && save(() => vendorStoreApi.saveStore(slug, { tagline }), 'Tagline saved')} />
          <span className="block text-xs text-[var(--vs-muted)] font-normal mt-1">The line under your name on the store.</span>
        </label>
        <label className="font-medium">Your shipping ($)
          <input inputMode="decimal" className="mt-1 w-full rounded-xl border border-[var(--vs-line)] px-3 h-11 outline-none focus:border-[var(--vs-primary)]" value={ship} onChange={e => setShip(e.target.value)}
            onBlur={() => dollars(ship) !== store.ownShippingCents && save(() => vendorStoreApi.saveStore(slug, { ownShippingCents: dollars(ship) }), 'Shipping saved')} />
          <span className="block text-xs text-[var(--vs-muted)] font-normal mt-1">Charged once on orders with things you ship.</span>
        </label>
      </div>
    </Card>
  )
}

/**
 * David's price list for her (David 2026-10-26: "a spot on there where I can set the prices for things and a suggested
 * price she should sell them for"). Our price to her is what ITP keeps; the suggestion shows on her card with Use it;
 * she still sets her own price, and the server lifts it to our price if David raises ours above hers.
 */
function HerPrices({ items, slug, save }: { items: ManageItem[]; slug: string; save: (fn: () => Promise<unknown>, done?: string) => void }) {
  if (!items.length) return null
  return (
    <div className="mt-5">
      <p className="font-medium text-sm mb-2">Her prices from us</p>
      <div className="overflow-x-auto rounded-2xl bg-white border border-[var(--vs-line)]">
        <table className="w-full text-sm min-w-[620px]">
          <thead className="text-left text-[var(--vs-muted)]">
            <tr><th className="p-3">Product</th><th className="p-3">Our price to her</th><th className="p-3">Suggested price</th><th className="p-3">Her price</th><th className="p-3 text-right">She earns</th></tr>
          </thead>
          <tbody>{items.map(i => <HerPriceRow key={i.id} item={i} slug={slug} save={save} />)}</tbody>
        </table>
      </div>
    </div>
  )
}

function HerPriceRow({ item, slug, save }: { item: ManageItem; slug: string; save: (fn: () => Promise<unknown>, done?: string) => void }) {
  const [cost, setCost] = useState((item.itpCostCents / 100).toFixed(2))
  const [suggested, setSuggested] = useState(item.suggestedPriceCents != null ? (item.suggestedPriceCents / 100).toFixed(2) : '')
  useEffect(() => setCost((item.itpCostCents / 100).toFixed(2)), [item.itpCostCents])
  useEffect(() => setSuggested(item.suggestedPriceCents != null ? (item.suggestedPriceCents / 100).toFixed(2) : ''), [item.suggestedPriceCents])
  const box = 'flex items-center rounded-xl border border-[var(--vs-line)] px-3 h-9 w-28 focus-within:border-[var(--vs-primary)]'
  return (
    <tr className="border-t border-[var(--vs-line)]">
      <td className="p-3 font-medium">{item.name}{!item.active && <span className="ml-2 text-xs text-[var(--vs-muted)]">(off on her store)</span>}</td>
      <td className="p-3">
        <span className={box}>$<input inputMode="decimal" className="w-full outline-none px-1" value={cost} aria-label={`Our price to her for ${item.name}`} onChange={e => setCost(e.target.value)}
          onBlur={() => dollars(cost) !== item.itpCostCents && dollars(cost) >= 0 && save(() => vendorStoreApi.saveItem(slug, item.id, { itpCostCents: dollars(cost) }), 'Her price from us saved')} /></span>
      </td>
      <td className="p-3">
        <span className={box}>$<input inputMode="decimal" className="w-full outline-none px-1" value={suggested} placeholder="—" aria-label={`Suggested price for ${item.name}`} onChange={e => setSuggested(e.target.value)}
          onBlur={() => {
            const next = suggested.trim() ? dollars(suggested) : null
            if (next !== item.suggestedPriceCents) save(() => vendorStoreApi.saveItem(slug, item.id, { suggestedPriceCents: next }), 'Suggested price saved')
          }} /></span>
      </td>
      <td className="p-3">{money(item.priceCents)}</td>
      <td className="p-3 text-right font-semibold text-[var(--vs-green)]">{money(Math.max(0, item.priceCents - item.itpCostCents))}</td>
    </tr>
  )
}

function AdminPanel({ data, slug, save }: { data: ManageData; slug: string; save: (fn: () => Promise<unknown>, done?: string) => void }) {
  const { store } = data
  const [fee, setFee] = useState(String(store.feePercent))
  const [ownShip, setOwnShip] = useState((store.ownShippingCents / 100).toFixed(2))
  const [itpShip, setItpShip] = useState((store.itpShippingCents / 100).toFixed(2))
  const [owner, setOwner] = useState(store.ownerEmail || '')
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Array<{ id: string; name: string; priceCents: number; costCents: number | null; image: string | null }>>([])
  const [herPrice, setHerPrice] = useState<Record<string, string>>({})

  const find = () => vendorStoreApi.searchCatalog(slug, q).then(r => setResults(r.products)).catch(() => setResults([]))

  return (
    <section id="settings" className="rounded-3xl bg-[#efe8f7] border border-[var(--vs-line)] p-4 sm:p-6 scroll-mt-28">
      <h2 className="flex items-center gap-2 font-semibold text-[var(--vs-primary)] mb-4"><Lock className="w-5 h-5" /> Admin only</h2>
      <div className="grid sm:grid-cols-2 xl:grid-cols-5 gap-4 text-sm">
        <label className="font-medium">Fee on her products (%)
          <input className="mt-1 w-full rounded-xl border border-[var(--vs-line)] bg-white px-3 h-10" value={fee} onChange={e => setFee(e.target.value)} onBlur={() => Number(fee) !== store.feePercent && save(() => vendorStoreApi.saveStore(slug, { feePercent: Number(fee) }))} />
        </label>
        <label className="font-medium">Her shipping ($)
          <input className="mt-1 w-full rounded-xl border border-[var(--vs-line)] bg-white px-3 h-10" value={ownShip} onChange={e => setOwnShip(e.target.value)} onBlur={() => dollars(ownShip) !== store.ownShippingCents && save(() => vendorStoreApi.saveStore(slug, { ownShippingCents: dollars(ownShip) }))} />
        </label>
        <label className="font-medium">Our shipping ($)
          <input className="mt-1 w-full rounded-xl border border-[var(--vs-line)] bg-white px-3 h-10" value={itpShip} onChange={e => setItpShip(e.target.value)} onBlur={() => dollars(itpShip) !== store.itpShippingCents && save(() => vendorStoreApi.saveStore(slug, { itpShippingCents: dollars(itpShip) }))} />
        </label>
        <label className="font-medium">Store status
          <select className="mt-1 w-full rounded-xl border border-[var(--vs-line)] bg-white px-3 h-10" value={store.status} onChange={e => save(() => vendorStoreApi.saveStore(slug, { status: e.target.value }), 'Status saved')}>
            <option value="draft">Draft</option><option value="live">Live</option><option value="paused">Paused</option>
          </select>
        </label>
        <label className="font-medium">Owner email
          <input className="mt-1 w-full rounded-xl border border-[var(--vs-line)] bg-white px-3 h-10" value={owner} onChange={e => setOwner(e.target.value)} onBlur={() => owner !== (store.ownerEmail || '') && save(() => vendorStoreApi.saveStore(slug, { ownerEmail: owner }), 'Owner saved')} />
        </label>
      </div>
      <HerPrices items={data.items.filter(i => i.kind === 'itp')} slug={slug} save={save} />
      <div className="mt-5">
        <p className="font-medium text-sm mb-2">Offer a product</p>
        <div className="flex gap-2 max-w-xl">
          <span className="flex-1 flex items-center rounded-xl border border-[var(--vs-line)] bg-white px-3 h-10"><Search className="w-4 h-4 text-[var(--vs-muted)]" />
            <input className="w-full outline-none px-2" placeholder="Search products…" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && find()} />
          </span>
          <button className="vs-btn-solid rounded-xl px-4 h-10 text-sm font-semibold" onClick={find}>Search</button>
        </div>
        {results.length > 0 && (
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3 mt-3">
            {results.map(p => (
              <div key={p.id} className="flex gap-3 items-center rounded-2xl bg-white border border-[var(--vs-line)] p-2">
                {p.image && <img src={p.image} alt="" className="w-14 h-14 rounded-lg object-cover" />}
                <div className="flex-1 min-w-0 text-sm">
                  <p className="font-medium truncate">{p.name}</p>
                  <p className="text-[var(--vs-muted)]">Retail {money(p.priceCents)}</p>
                </div>
                <span className="flex items-center rounded-lg border border-[var(--vs-line)] px-2 h-9 w-24 text-sm">$
                  <input inputMode="decimal" className="w-full outline-none px-1" placeholder="Her price" aria-label={`Her price for ${p.name}`} value={herPrice[p.id] ?? ''} onChange={e => setHerPrice({ ...herPrice, [p.id]: e.target.value })} />
                </span>
                <button className="vs-btn-pink rounded-lg px-3 h-9 text-sm font-semibold" onClick={() => dollars(herPrice[p.id] || '') > 0 && save(() => vendorStoreApi.offer(slug, p.id, dollars(herPrice[p.id])), 'Offered')}>Offer</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
