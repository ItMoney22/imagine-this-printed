// Admin > Margins — blank cost vs retail vs margin, per variant.
//
// Watchtower 767f74d4. This screen exists so a losing SKU cannot hide: the
// list is sorted by the THINNEST variant margin, so whatever is bleeding is
// the first row on the page. Every figure comes from /api/admin/margins, which
// computes them with the same module that stamps the storefront's prices.
//
// Styling follows AdminDashboard's own surface (white cards, slate text,
// purple accent) rather than the storefront's semantic tokens — this renders
// inside that page and matching it is the point.
import React, { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../lib/api'

interface WorstVariant {
  tier: string
  size: string
  color: string
  cost: number
  retail: number
  margin: number
  marginPct: number
}

interface MarginProduct {
  id: string
  name: string
  category: string | null
  status: string | null
  garment?: string
  listed_price: number
  priced_per_variant: boolean
  stamped_at?: string | null
  costs_synced_at?: string | null
  markup_pct?: number
  decoration_cost?: number | null
  base_blank_cost?: number | null
  underwater?: boolean
  variants?: number
  underwater_variants?: number
  worst_variant?: WorstVariant | null
  avg_recovered_per_unit?: number
  issue?: string | null
}

interface MarginSummary {
  products: number
  priced_per_variant: number
  underwater: number
  cost_rows: number
  costs_oldest_sync: string | null
  markup_pct: number
}

interface StyleRow {
  code: string
  brand: string
  style: string
  label: string
  tier_id: string | null
  garment_id: string | null
  colors: number
  variants: number
  min_cost: number | null
  max_cost: number | null
}

interface GridRow {
  tier: string
  style: string | null
  size: string
  color: string
  blank_cost: number
  retail: number
  was_retail: number
  delta: number
  margin: number
  margin_pct: number
  underwater: boolean
}

const money = (n: number | null | undefined) => (n == null ? '—' : `$${Number(n).toFixed(2)}`)
const pct = (n: number | null | undefined) => (n == null ? '—' : `${Number(n).toFixed(1)}%`)

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  return Number.isFinite(ms) ? Math.floor(ms / 86_400_000) : null
}

/** Margin health, as a colour the eye reads before the number. */
function marginTone(marginPct: number | null | undefined): string {
  if (marginPct == null) return 'text-slate-400'
  if (marginPct <= 0) return 'text-rose-600 font-bold'
  if (marginPct < 40) return 'text-amber-600 font-semibold'
  return 'text-emerald-600 font-semibold'
}

export default function AdminVariantMargins() {
  const [products, setProducts] = useState<MarginProduct[]>([])
  const [summary, setSummary] = useState<MarginSummary | null>(null)
  const [styles, setStyles] = useState<StyleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [onlyProblems, setOnlyProblems] = useState(false)
  const [search, setSearch] = useState('')

  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<{ product: any; colors: { id: string; label: string; hex: string }[]; grid: GridRow[] } | null>(null)
  const [detailColor, setDetailColor] = useState<string>('Black')
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const [list, costs] = await Promise.all([
          apiFetch('/api/admin/margins'),
          apiFetch('/api/admin/margins/costs')
        ])
        if (cancelled) return
        setProducts(list.products || [])
        setSummary(list.summary || null)
        setStyles(costs.styles || [])
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to load margins')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!openId) {
      setDetail(null)
      return
    }
    let cancelled = false
    ;(async () => {
      setDetailLoading(true)
      try {
        const d = await apiFetch(`/api/admin/margins/${openId}?color=${encodeURIComponent(detailColor)}`)
        if (!cancelled) setDetail(d)
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to load variant grid')
      } finally {
        if (!cancelled) setDetailLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [openId, detailColor])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products.filter(p => {
      if (onlyProblems && !(p.underwater || (p.underwater_variants ?? 0) > 0 || !p.priced_per_variant || p.issue)) return false
      if (q && !p.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [products, onlyProblems, search])

  const staleDays = daysSince(summary?.costs_oldest_sync)

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-6">
        <div className="h-2 w-40 bg-slate-100 rounded-full overflow-hidden mb-3">
          <div className="h-full w-1/2 bg-purple-500 animate-pulse rounded-full" />
        </div>
        <p className="text-sm text-slate-500">Reading supplier costs and re-deriving every variant margin…</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-4 text-sm">{error}</div>
      )}

      {/* Headline numbers */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryTile label="Apparel listings" value={String(summary?.products ?? 0)} sub={`${summary?.priced_per_variant ?? 0} priced per variant`} />
        <SummaryTile
          label="Losing money"
          value={String(summary?.underwater ?? 0)}
          sub={summary?.underwater ? 'listings with a variant at or below its blank' : 'no variant sells under its blank'}
          tone={summary?.underwater ? 'rose' : 'emerald'}
        />
        <SummaryTile label="House markup" value={`${summary?.markup_pct ?? 20}%`} sub="on the exact blank cost, plus decoration" />
        <SummaryTile
          label="Supplier costs"
          value={String(summary?.cost_rows ?? 0)}
          sub={staleDays == null ? 'never synced' : staleDays <= 1 ? 'synced today' : `oldest is ${staleDays} days old`}
          tone={staleDays != null && staleDays > 30 ? 'amber' : undefined}
        />
      </div>

      {/* Supplier cost table health */}
      <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-6">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="text-lg font-display font-bold text-slate-900">Blank costs by style</h3>
          <code className="text-[11px] text-slate-500">npx tsx --env-file=.env scripts/sync-jiffy-costs.ts --colors all</code>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-100">
                <Th>Blank</Th><Th>Code</Th><Th>Tier</Th><Th>Garment</Th>
                <Th right>Colours</Th><Th right>Variants</Th><Th right>Cost range</Th>
              </tr>
            </thead>
            <tbody>
              {styles.map(s => (
                <tr key={s.code} className="border-b border-slate-50 hover:bg-slate-50">
                  <Td><span className="font-semibold text-slate-900">{s.brand} {s.style}</span> <span className="text-slate-500">{s.label}</span></Td>
                  <Td><code className="text-xs text-slate-600">{s.code}</code></Td>
                  <Td className="capitalize">{s.tier_id ?? '—'}</Td>
                  <Td>{s.garment_id ?? '—'}</Td>
                  <Td right>{s.colors}</Td>
                  <Td right>{s.variants}</Td>
                  <Td right>{s.variants ? `${money(s.min_cost)} – ${money(s.max_cost)}` : '—'}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per-product margins */}
      <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-lg font-display font-bold text-slate-900">Margin by listing</h3>
            <p className="text-sm text-slate-500">Thinnest variant first. Margin is retail minus the blank it is printed on.</p>
          </div>
          <div className="flex items-center gap-3">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search listings"
              className="px-3 py-2 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-purple-500/30"
            />
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={onlyProblems} onChange={e => setOnlyProblems(e.target.checked)} />
              Problems only
            </label>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-100">
                <Th>Listing</Th><Th>Garment</Th><Th right>Listed</Th><Th right>Blank (base)</Th>
                <Th right>Decoration</Th><Th>Worst variant</Th><Th right>Its margin</Th><Th right>Variants</Th><Th />
              </tr>
            </thead>
            <tbody>
              {visible.map(p => {
                const w = p.worst_variant
                return (
                  <React.Fragment key={p.id}>
                    <tr className={`border-b border-slate-50 hover:bg-slate-50 ${p.underwater ? 'bg-rose-50/60' : ''}`}>
                      <Td>
                        <span className="font-semibold text-slate-900">{p.name}</span>
                        {!p.priced_per_variant && (
                          <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-amber-100 text-amber-800 align-middle">flat priced</span>
                        )}
                        {p.issue && <div className="text-[11px] text-rose-600 mt-0.5">{p.issue}</div>}
                      </Td>
                      <Td>{p.garment ?? '—'}</Td>
                      <Td right>{money(p.listed_price)}</Td>
                      <Td right>{money(p.base_blank_cost)}</Td>
                      <Td right>{money(p.decoration_cost)}</Td>
                      <Td>
                        {w ? (
                          <span className="text-slate-600">
                            <span className="capitalize">{w.tier}</span> · {w.size} · {w.color}
                          </span>
                        ) : '—'}
                      </Td>
                      <Td right>
                        {w ? (
                          <span className={marginTone(w.marginPct)}>
                            {money(w.margin)} <span className="text-xs font-normal">({pct(w.marginPct)})</span>
                          </span>
                        ) : '—'}
                      </Td>
                      <Td right>
                        {p.variants ?? 0}
                        {(p.underwater_variants ?? 0) > 0 && (
                          <span className="ml-1 text-rose-600 font-semibold">({p.underwater_variants} under)</span>
                        )}
                      </Td>
                      <Td right>
                        <button
                          onClick={() => setOpenId(openId === p.id ? null : p.id)}
                          className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-purple-100 text-slate-700 hover:text-purple-800 transition-colors"
                        >
                          {openId === p.id ? 'Hide' : 'Variants'}
                        </button>
                      </Td>
                    </tr>

                    {openId === p.id && (
                      <tr>
                        <td colSpan={9} className="bg-slate-50 px-4 py-4">
                          {detailLoading && <p className="text-sm text-slate-500">Loading the tier by size grid…</p>}
                          {!detailLoading && detail && (
                            <>
                              <div className="flex flex-wrap items-center gap-2 mb-3">
                                <span className="text-xs text-slate-500 mr-1">Colour:</span>
                                {detail.colors.map(c => (
                                  <button
                                    key={c.id}
                                    onClick={() => setDetailColor(c.label)}
                                    className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                                      detailColor === c.label
                                        ? 'border-purple-500 bg-purple-50 text-purple-800'
                                        : 'border-slate-200 bg-white text-slate-600 hover:border-purple-300'
                                    }`}
                                  >
                                    {c.label}
                                  </button>
                                ))}
                              </div>
                              <div className="overflow-x-auto">
                                <table className="min-w-full text-xs">
                                  <thead>
                                    <tr className="text-left text-slate-500 border-b border-slate-200">
                                      <Th>Tier</Th><Th>Blank</Th><Th>Size</Th>
                                      <Th right>Cost</Th><Th right>Retail</Th><Th right>Was</Th>
                                      <Th right>Change</Th><Th right>Margin</Th><Th right>Margin %</Th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {detail.grid.map(g => (
                                      <tr key={`${g.tier}-${g.size}`} className={`border-b border-slate-100 ${g.underwater ? 'bg-rose-100/60' : ''}`}>
                                        <Td className="capitalize">{g.tier}</Td>
                                        <Td>{g.style ?? '—'}</Td>
                                        <Td className="font-semibold text-slate-900">{g.size}</Td>
                                        <Td right>{money(g.blank_cost)}</Td>
                                        <Td right className="font-semibold text-slate-900">{money(g.retail)}</Td>
                                        <Td right className="text-slate-400">{money(g.was_retail)}</Td>
                                        <Td right className={g.delta > 0 ? 'text-emerald-700 font-semibold' : g.delta < 0 ? 'text-rose-700' : 'text-slate-400'}>
                                          {g.delta === 0 ? '—' : `${g.delta > 0 ? '+' : ''}${g.delta.toFixed(2)}`}
                                        </Td>
                                        <Td right className={marginTone(g.margin_pct)}>{money(g.margin)}</Td>
                                        <Td right className={marginTone(g.margin_pct)}>{pct(g.margin_pct)}</Td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              <p className="text-[11px] text-slate-500 mt-3">
                                “Was” is what this variant charged under the flat $2.50 plus-size rule and the flat tier ladder.
                                Retail is {detail.product.markup_pct}% on the blank plus {money(detail.product.decoration_cost)} decoration.
                                Youth sizes keep the ${YOUTH_MARKDOWN.toFixed(2)} markdown on top.
                              </p>
                            </>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-500 text-sm">Nothing matches that filter.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// Mirrors YOUTH_SIZE_DISCOUNT_DOLLARS — imported as a literal here rather than
// pulling the shared module into the admin bundle for one number.
const YOUTH_MARKDOWN = 3

function SummaryTile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'rose' | 'emerald' | 'amber' }) {
  const ring =
    tone === 'rose' ? 'border-rose-200 bg-rose-50' :
    tone === 'emerald' ? 'border-emerald-200 bg-emerald-50' :
    tone === 'amber' ? 'border-amber-200 bg-amber-50' :
    'border-slate-100 bg-white'
  return (
    <div className={`rounded-2xl shadow-soft border p-5 ${ring}`}>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-2xl font-display font-bold text-slate-900 mt-1">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  )
}

function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return <th className={`py-2 px-3 font-medium whitespace-nowrap ${right ? 'text-right' : ''}`}>{children}</th>
}

function Td({ children, right, className = '' }: { children?: React.ReactNode; right?: boolean; className?: string }) {
  return <td className={`py-2 px-3 whitespace-nowrap ${right ? 'text-right' : ''} ${className}`}>{children}</td>
}
