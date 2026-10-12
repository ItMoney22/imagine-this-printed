// Design performance — /admin/design-performance (task 47174caa).
//
// Which designs shoppers stop on, click, cart and buy, per AI prompt variant,
// with the prune / refresh verdict. Numbers come from GET
// /api/admin/design-performance (backend/services/design-performance.ts); the
// per-row "Check raw events" re-counts straight off the event table so any row
// can be reconciled by hand.
import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowUp, CheckCircle2, ChevronDown, ChevronUp, Columns3, List, TrendingUp } from 'lucide-react'
import { apiFetch } from '../lib/api'

type Flag = 'learning' | 'healthy' | 'refresh' | 'prune'

interface Counts { impressions: number; clicks: number; detailViews: number; addToCarts: number; orders: number; units: number; revenue: number }
interface Rates { ctr: number | null; addToCartRate: number | null; conversion: number | null }
interface ReportProduct { id: string; name: string; slug: string | null; status: string | null; category: string | null; image: string | null; artworkId: string | null; counts: Counts }
interface Variant {
  variantId: string; variantKey: string; conceptKey: string; conceptLabel: string
  promptText: string | null; modelId: string | null; source: string
  products: ReportProduct[]; counts: Counts; rates: Rates; flag: Flag; flagReason: string
}
interface Report {
  window: { since: string; until: string; days: number }
  store: { counts: Counts; rates: Rates }
  rules: { minImpressions: number; minDetailViews: number; ratioOfStore: number }
  variants: Variant[]
  concepts: Array<{ conceptKey: string; conceptLabel: string; variantIds: string[] }>
}

const WINDOWS = [7, 30, 90] as const
type SortKey = 'flag' | 'impressions' | 'clicks' | 'ctr' | 'detailViews' | 'addToCarts' | 'addToCartRate' | 'orders'
type Filter = 'all' | 'attention' | 'ai' | 'handmade'

const FLAG_LABEL: Record<Flag, string> = { prune: 'Prune', refresh: 'Refresh', learning: 'Learning', healthy: 'Healthy' }
const FLAG_STYLE: Record<Flag, string> = {
  prune: 'bg-red-500/15 text-red-600 border-red-500/30',
  refresh: 'bg-amber-500/15 text-amber-700 border-amber-500/30',
  learning: 'bg-bg text-muted border-border',
  healthy: 'bg-green-500/15 text-green-700 border-green-500/30',
}
const FLAG_ORDER: Record<Flag, number> = { prune: 0, refresh: 1, learning: 2, healthy: 3 }
const SOURCE_LABEL: Record<string, string> = {
  mrs_imagine: 'Mrs. Imagine brief', step_flow: 'Step Flow', design_modal: 'Design studio', ai: 'AI prompt',
  library: 'Design library', creator: 'Creator upload', handmade: 'Hand-made',
}

const pct = (r: number | null) => (r === null ? '—' : `${(r * 100).toFixed(r < 0.1 ? 1 : 0)}%`)
const n = (v: number) => v.toLocaleString()
const count = (v: number, one: string, many: string) => `${n(v)} ${v === 1 ? one : many}`
const isAi = (v: Variant) => v.promptText !== null

function sortValue(v: Variant, key: SortKey): number {
  switch (key) {
    case 'flag': return FLAG_ORDER[v.flag]
    case 'ctr': return v.rates.ctr ?? -1
    case 'addToCartRate': return v.rates.addToCartRate ?? -1
    default: return v.counts[key]
  }
}

function FlagBadge({ flag }: { flag: Flag }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${FLAG_STYLE[flag]}`}>{FLAG_LABEL[flag]}</span>
}

function Thumb({ v }: { v: Variant }) {
  const img = v.products.find(p => p.image)?.image
  return (
    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-border bg-white">
      {img ? <img src={img} alt="" className="h-full w-full object-cover" loading="lazy" /> : null}
    </div>
  )
}

function StatTile({ label, value, sub, className = '' }: { label: string; value: string; sub: string; className?: string }) {
  return (
    <div className={`rounded-xl border border-border bg-card p-4 shadow-soft ${className}`}>
      <div className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-1 font-display text-2xl font-bold text-text">{value}</div>
      <div className="text-xs text-muted">{sub}</div>
    </div>
  )
}

function RawCheck({ v, days }: { v: Variant; days: number }) {
  const [raw, setRaw] = useState<Array<{ productId: string; counts: Record<string, number> }> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      setRaw(await Promise.all(v.products.map(p => apiFetch(`/api/admin/design-performance/raw/${p.id}?days=${days}`))))
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  // A product sold under more than one variant (a redo) splits its raw rows
  // between them, so the match is only exact for a single-variant product.
  const total = raw?.reduce((t, r) => ({
    impression: t.impression + (r.counts.impression || 0),
    click: t.click + (r.counts.click || 0),
    detail_view: t.detail_view + (r.counts.detail_view || 0),
    add_to_cart: t.add_to_cart + (r.counts.add_to_cart || 0),
    order: t.order + (r.counts.order || 0),
  }), { impression: 0, click: 0, detail_view: 0, add_to_cart: 0, order: 0 })
  const matches = total
    && total.impression === v.counts.impressions && total.click === v.counts.clicks
    && total.detail_view === v.counts.detailViews && total.add_to_cart === v.counts.addToCarts
    && total.order === v.counts.orders

  return (
    <div className="mt-3">
      <button
        onClick={run}
        disabled={busy}
        className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-text hover:border-primary hover:text-primary disabled:opacity-50"
      >
        {busy ? 'Counting raw events…' : 'Check against raw events'}
      </button>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {total && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <span>Raw: {count(total.impression, 'tile view', 'tile views')} · {count(total.click, 'click', 'clicks')} · {count(total.detail_view, 'page view', 'page views')} · {count(total.add_to_cart, 'cart', 'carts')} · {count(total.order, 'order', 'orders')}</span>
          {matches
            ? <span className="inline-flex items-center gap-1 font-semibold text-green-700"><CheckCircle2 className="h-3.5 w-3.5" /> Matches this row</span>
            : <span className="font-semibold text-amber-700">Differs: this product also has rows under another prompt (a redo)</span>}
        </div>
      )}
    </div>
  )
}

function VariantDetail({ v, days }: { v: Variant; days: number }) {
  return (
    <div className="space-y-3 text-sm">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-muted">Prompt</div>
        <p className="mt-1 whitespace-pre-wrap text-text">{v.promptText || 'No AI prompt: a hand-made design.'}</p>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
        <span>Idea: <span className="text-text">{v.conceptLabel}</span></span>
        <span>Made by: <span className="text-text">{SOURCE_LABEL[v.source] || v.source}</span></span>
        {v.modelId && <span>Model: <span className="text-text">{v.modelId}</span></span>}
        <span>Variant: <span className="font-mono text-text">{v.variantKey}</span></span>
      </div>
      <p className="text-xs text-muted">{v.flagReason}</p>
      <ul className="space-y-1">
        {v.products.map(p => (
          <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
            <Link to={`/product/${p.slug || p.id}`} className="font-semibold text-primary hover:underline">{p.name}</Link>
            {p.status !== 'active' && <span className="text-muted">({p.status || 'removed'})</span>}
            <span className="text-muted">{count(p.counts.impressions, 'view', 'views')} · {count(p.counts.clicks, 'click', 'clicks')} · {count(p.counts.detailViews, 'page view', 'page views')} · {count(p.counts.addToCarts, 'cart', 'carts')} · {count(p.counts.orders, 'order', 'orders')}</span>
            {p.artworkId && <span className="font-mono text-muted">artwork {p.artworkId.slice(0, 12)}</span>}
          </li>
        ))}
      </ul>
      <RawCheck v={v} days={days} />
    </div>
  )
}

function SortHeader({ label, k, sort, setSort, align = 'right' }: { label: string; k: SortKey; sort: { key: SortKey; asc: boolean }; setSort: (s: { key: SortKey; asc: boolean }) => void; align?: 'left' | 'right' }) {
  const active = sort.key === k
  return (
    <th className={`px-3 py-2 font-semibold ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button
        onClick={() => setSort({ key: k, asc: active ? !sort.asc : k === 'flag' })}
        className={`inline-flex items-center gap-1 ${active ? 'text-primary' : 'text-muted hover:text-text'}`}
      >
        {label}
        {active && (sort.asc ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </button>
    </th>
  )
}

function CompareCard({ v, best }: { v: Variant; best: { ctr: number; cart: number } }) {
  const bar = (r: number | null, top: number) => `${top > 0 && r ? Math.max(4, Math.round((r / top) * 100)) : 0}%`
  return (
    <div className="flex flex-col rounded-xl border border-border bg-card p-4 shadow-soft">
      <div className="flex items-start gap-3">
        <Thumb v={v} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-text">{v.products[0]?.name || 'Design'}</div>
          <div className="mt-1"><FlagBadge flag={v.flag} /></div>
        </div>
      </div>
      <p className="mt-3 line-clamp-3 text-xs text-muted">{v.promptText || 'Hand-made design'}</p>
      <dl className="mt-3 space-y-2 text-xs">
        <div>
          <div className="flex justify-between"><dt className="text-muted">Click-through</dt><dd className="font-semibold text-text">{pct(v.rates.ctr)}</dd></div>
          <div className="mt-1 h-1.5 rounded-full bg-bg"><div className="h-full rounded-full bg-primary" style={{ width: bar(v.rates.ctr, best.ctr) }} /></div>
        </div>
        <div>
          <div className="flex justify-between"><dt className="text-muted">Add to cart</dt><dd className="font-semibold text-text">{pct(v.rates.addToCartRate)}</dd></div>
          <div className="mt-1 h-1.5 rounded-full bg-bg"><div className="h-full rounded-full bg-secondary" style={{ width: bar(v.rates.addToCartRate, best.cart) }} /></div>
        </div>
        <div className="flex justify-between pt-1 text-muted">
          <span>{count(v.counts.impressions, 'view', 'views')} · {count(v.counts.clicks, 'click', 'clicks')}</span>
          <span className="font-semibold text-text">{count(v.counts.orders, 'order', 'orders')}</span>
        </div>
      </dl>
      <p className="mt-3 text-xs text-muted">{v.flagReason}</p>
    </div>
  )
}

const AdminDesignPerformance: React.FC = () => {
  const [days, setDays] = useState<number>(30)
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [elapsed, setElapsed] = useState(0)
  const [view, setView] = useState<'table' | 'compare'>('table')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'flag', asc: true })
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setElapsed(0)
    const started = Date.now()
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    apiFetch(`/api/admin/design-performance?days=${days}`)
      .then(r => { if (!cancelled) setReport(r) })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { clearInterval(tick); if (!cancelled) setLoading(false) })
    return () => { cancelled = true; clearInterval(tick) }
  }, [days])

  const rows = useMemo(() => {
    if (!report) return []
    const list = report.variants.filter(v =>
      filter === 'all' ? true
        : filter === 'attention' ? v.flag === 'prune' || v.flag === 'refresh'
          : filter === 'ai' ? isAi(v) : !isAi(v))
    const dir = sort.asc ? 1 : -1
    return [...list].sort((a, b) => (sortValue(a, sort.key) - sortValue(b, sort.key)) * dir || (a.rates.ctr ?? 1) - (b.rates.ctr ?? 1))
  }, [report, filter, sort])

  const byId = useMemo(() => new Map((report?.variants || []).map(v => [v.variantId, v])), [report])
  const attention = report?.variants.filter(v => v.flag === 'prune' || v.flag === 'refresh').length ?? 0

  return (
    <div className="min-h-screen bg-bg p-4 text-text sm:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 font-display text-2xl font-bold sm:text-3xl">
              <TrendingUp className="h-6 w-6 text-primary" aria-hidden="true" /> Design performance
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted">
              Which designs shoppers stop on, click, add to cart and buy, by the AI prompt that drew them.
              Designs nobody clicks are marked to prune; designs that get clicks but no carts are marked to refresh.
            </p>
          </div>
          <div className="inline-flex rounded-lg border border-border bg-card p-1" role="group" aria-label="Time window">
            {WINDOWS.map(w => (
              <button
                key={w}
                onClick={() => setDays(w)}
                aria-pressed={days === w}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold ${days === w ? 'bg-primary text-white' : 'text-muted hover:text-text'}`}
              >
                {w} days
              </button>
            ))}
          </div>
        </header>

        {loading && (
          <div className="space-y-2" role="status">
            <div className="h-2 w-full overflow-hidden rounded-full bg-card">
              <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
            </div>
            <p className="text-xs text-muted">Counting the last {days} days of tile views, clicks, carts and paid orders… {elapsed}s</p>
          </div>
        )}
        {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600">Could not load the numbers: {error}</p>}

        {report && !loading && (
          <>
            <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <StatTile label="Tile views" value={n(report.store.counts.impressions)} sub={`last ${report.window.days} days`} />
              <StatTile label="Clicks" value={n(report.store.counts.clicks)} sub={`${pct(report.store.rates.ctr)} click-through`} />
              <StatTile label="Page views" value={n(report.store.counts.detailViews)} sub="product pages opened" />
              <StatTile label="Add to cart" value={n(report.store.counts.addToCarts)} sub={`${pct(report.store.rates.addToCartRate)} of page views`} />
              <StatTile label="Paid orders" value={n(report.store.counts.orders)} sub={`${pct(report.store.rates.conversion)} of page views`} className="col-span-2 md:col-span-1" />
            </section>

            <details className="rounded-xl border border-border bg-card p-4 text-sm">
              <summary className="cursor-pointer font-semibold text-text">How designs are judged</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
                <li><span className="font-semibold text-text">Prune</span>: seen at least {report.rules.minImpressions} times and, even read generously, clicked less than half as often as the shop average. Nobody stops on it.</li>
                <li><span className="font-semibold text-text">Refresh</span>: opened at least {report.rules.minDetailViews} times and added to cart less than half as often as the shop average. It draws clicks, then nobody buys.</li>
                <li><span className="font-semibold text-text">Learning</span>: not enough views yet to judge fairly.</li>
                <li>A design that sold in the window is never flagged. Orders are paid web-store orders, not Etsy, not cancelled. The shop's own browsing is not counted.</li>
              </ul>
            </details>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2" role="group" aria-label="Filter designs">
                {([
                  ['all', `All designs (${report.variants.length})`],
                  ['attention', `Needs attention (${attention})`],
                  ['ai', 'AI prompts'],
                  ['handmade', 'Hand-made'],
                ] as Array<[Filter, string]>).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setFilter(key)}
                    aria-pressed={filter === key}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold ${filter === key ? 'border-primary bg-primary text-white' : 'border-border bg-card text-muted hover:text-text'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="inline-flex rounded-lg border border-border bg-card p-1" role="group" aria-label="View">
                <button onClick={() => setView('table')} aria-pressed={view === 'table'} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold ${view === 'table' ? 'bg-primary text-white' : 'text-muted hover:text-text'}`}>
                  <List className="h-3.5 w-3.5" /> Every design
                </button>
                <button onClick={() => setView('compare')} aria-pressed={view === 'compare'} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold ${view === 'compare' ? 'bg-primary text-white' : 'text-muted hover:text-text'}`}>
                  <Columns3 className="h-3.5 w-3.5" /> Compare prompts ({report.concepts.length})
                </button>
              </div>
            </div>

            {view === 'table' && (
              rows.length === 0 ? (
                <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted">No designs match this filter.</p>
              ) : (
                <>
                  {/* Desktop: one sortable table. */}
                  <div className="hidden overflow-x-auto rounded-xl border border-border bg-card shadow-soft md:block">
                    <table className="w-full table-fixed text-sm">
                      <thead className="border-b border-border text-xs uppercase tracking-wider">
                        <tr>
                          <th className="w-[38%] px-3 py-2 text-left font-semibold text-muted">Design and prompt</th>
                          <SortHeader label="Views" k="impressions" sort={sort} setSort={setSort} />
                          <SortHeader label="Clicks" k="clicks" sort={sort} setSort={setSort} />
                          <SortHeader label="CTR" k="ctr" sort={sort} setSort={setSort} />
                          <SortHeader label="Page views" k="detailViews" sort={sort} setSort={setSort} />
                          <SortHeader label="Carts" k="addToCarts" sort={sort} setSort={setSort} />
                          <SortHeader label="Cart rate" k="addToCartRate" sort={sort} setSort={setSort} />
                          <SortHeader label="Orders" k="orders" sort={sort} setSort={setSort} />
                          <SortHeader label="Verdict" k="flag" sort={sort} setSort={setSort} align="left" />
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(v => (
                          <React.Fragment key={v.variantId}>
                            <tr className="border-b border-border-subtle align-top hover:bg-bg/60">
                              <td className="px-3 py-3">
                                <button onClick={() => setOpen(open === v.variantId ? null : v.variantId)} className="flex w-full items-start gap-3 text-left" aria-expanded={open === v.variantId}>
                                  <Thumb v={v} />
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate font-semibold text-text">{v.products.map(p => p.name).join(' · ')}</span>
                                    <span className="mt-0.5 line-clamp-2 text-xs text-muted">{v.promptText || 'Hand-made design'}</span>
                                  </span>
                                  {open === v.variantId ? <ChevronUp className="mt-1 h-4 w-4 shrink-0 text-muted" /> : <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-muted" />}
                                </button>
                              </td>
                              <td className="px-3 py-3 text-right tabular-nums">{n(v.counts.impressions)}</td>
                              <td className="px-3 py-3 text-right tabular-nums">{n(v.counts.clicks)}</td>
                              <td className="px-3 py-3 text-right font-semibold tabular-nums">{pct(v.rates.ctr)}</td>
                              <td className="px-3 py-3 text-right tabular-nums">{n(v.counts.detailViews)}</td>
                              <td className="px-3 py-3 text-right tabular-nums">{n(v.counts.addToCarts)}</td>
                              <td className="px-3 py-3 text-right font-semibold tabular-nums">{pct(v.rates.addToCartRate)}</td>
                              <td className="px-3 py-3 text-right tabular-nums">{n(v.counts.orders)}</td>
                              <td className="px-3 py-3"><FlagBadge flag={v.flag} /></td>
                            </tr>
                            {open === v.variantId && (
                              <tr className="border-b border-border-subtle bg-bg/40">
                                <td colSpan={9} className="px-4 py-4"><VariantDetail v={v} days={days} /></td>
                              </tr>
                            )}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Phone: one card per design. */}
                  <div className="space-y-3 md:hidden">
                    <label className="flex items-center gap-2 text-xs text-muted">
                      Sort by
                      <select
                        value={sort.key}
                        onChange={e => setSort({ key: e.target.value as SortKey, asc: e.target.value === 'flag' })}
                        className="rounded-lg border border-border bg-card px-2 py-1 text-xs text-text"
                      >
                        <option value="flag">Verdict</option>
                        <option value="ctr">Click-through</option>
                        <option value="addToCartRate">Cart rate</option>
                        <option value="impressions">Views</option>
                        <option value="orders">Orders</option>
                      </select>
                    </label>
                    {rows.map(v => (
                      <div key={v.variantId} className="rounded-xl border border-border bg-card p-3 shadow-soft">
                        <button onClick={() => setOpen(open === v.variantId ? null : v.variantId)} className="flex w-full items-start gap-3 text-left" aria-expanded={open === v.variantId}>
                          <Thumb v={v} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-text">{v.products.map(p => p.name).join(' · ')}</span>
                            <span className="mt-1 block"><FlagBadge flag={v.flag} /></span>
                          </span>
                        </button>
                        <dl className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
                          <div><dt className="text-muted">Views</dt><dd className="font-semibold">{n(v.counts.impressions)}</dd></div>
                          <div><dt className="text-muted">CTR</dt><dd className="font-semibold">{pct(v.rates.ctr)}</dd></div>
                          <div><dt className="text-muted">Cart</dt><dd className="font-semibold">{pct(v.rates.addToCartRate)}</dd></div>
                          <div><dt className="text-muted">Orders</dt><dd className="font-semibold">{n(v.counts.orders)}</dd></div>
                        </dl>
                        {open === v.variantId && <div className="mt-3 border-t border-border pt-3"><VariantDetail v={v} days={days} /></div>}
                      </div>
                    ))}
                  </div>
                </>
              )
            )}

            {view === 'compare' && (
              report.concepts.length === 0 ? (
                <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted">
                  No idea has two prompts live yet. When one idea is drawn from two prompts (a Step Flow redo with an
                  edited prompt, two models on one brief), the variants line up here side by side.
                </p>
              ) : (
                <div className="space-y-6">
                  {report.concepts.map(c => {
                    const vs = c.variantIds.map(id => byId.get(id)).filter((v): v is Variant => !!v)
                    const best = {
                      ctr: Math.max(0, ...vs.map(v => v.rates.ctr ?? 0)),
                      cart: Math.max(0, ...vs.map(v => v.rates.addToCartRate ?? 0)),
                    }
                    return (
                      <section key={c.conceptKey} className="rounded-2xl border border-border bg-bg-warm/40 p-4">
                        <h2 className="font-display text-lg font-bold text-text">{c.conceptLabel}</h2>
                        <p className="mb-3 text-xs text-muted">{vs.length} prompts for this idea</p>
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                          {vs.map(v => <CompareCard key={v.variantId} v={v} best={best} />)}
                        </div>
                      </section>
                    )
                  })}
                </div>
              )
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default AdminDesignPerformance
