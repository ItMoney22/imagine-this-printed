// Team templates — the picker. /admin/team-templates
//
// Lists apparel products (shirts and hoodies) to configure team personalization.
// Customers can customize the back of personalizable products with their name and number.
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Search, Shirt, CheckCircle2, Sparkles, PlusCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'

const PAGE_SIZE = 24

interface Row {
  id: string
  name: string
  images: string[] | null
  metadata: Record<string, any> | null
}

type FilterTab = 'all' | 'configured' | 'unconfigured'

const AdminTeamTemplatesIndex: React.FC = () => {
  const [rows, setRows] = useState<Row[]>([])
  const [query, setQuery] = useState('')
  const [filterTab, setFilterTab] = useState<FilterTab>('all')
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('products')
      .select('id, name, images, metadata', { count: 'exact' })
      .in('category', ['shirts', 'hoodies'])
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)

    if (query.trim()) {
      q = q.ilike('name', `%${query.trim()}%`)
    }

    const { data, count } = await q
    setRows((data as Row[]) ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }, [page, query])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setPage(0)
  }, [query, filterTab])

  const filteredRows = useMemo(() => {
    if (filterTab === 'all') return rows
    if (filterTab === 'configured') return rows.filter((r) => Boolean(r.metadata?.team_template))
    return rows.filter((r) => !r.metadata?.team_template)
  }, [rows, filterTab])

  const configuredCount = useMemo(() => {
    return rows.filter((r) => Boolean(r.metadata?.team_template)).length
  }, [rows])

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="min-h-screen bg-bg p-6 text-text">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Navigation & Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Link
              to="/admin"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card text-muted transition-colors hover:border-primary hover:text-text"
              title="Return to Admin Dashboard"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-display text-2xl font-bold tracking-tight">Team Templates</h1>
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                  <Sparkles className="h-3 w-3" /> Flare Lettering
                </span>
              </div>
              <p className="text-sm text-muted">
                Configure back personalization for shirts and hoodies in 4 simple steps.
              </p>
            </div>
          </div>

          {/* Metric Highlights */}
          <div className="flex items-center gap-2">
            <div className="rounded-xl border border-border bg-card px-4 py-2 text-right">
              <span className="text-xs uppercase tracking-wider text-muted">Personalizable</span>
              <p className="text-lg font-bold text-primary">
                {configuredCount}{' '}
                <span className="text-xs font-normal text-muted">/ {rows.length} on page</span>
              </p>
            </div>
          </div>
        </div>

        {/* Search & Filter Tabs */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search shirts and hoodies by name…"
              className="w-full rounded-xl border border-border bg-card py-2.5 pl-9 pr-3 text-sm text-text placeholder:text-muted focus:border-primary focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1 rounded-xl border border-border bg-card p-1">
            <button
              onClick={() => setFilterTab('all')}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                filterTab === 'all'
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-muted hover:text-text'
              }`}
            >
              All Apparel
            </button>
            <button
              onClick={() => setFilterTab('configured')}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                filterTab === 'configured'
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-muted hover:text-text'
              }`}
            >
              Personalizable
            </button>
            <button
              onClick={() => setFilterTab('unconfigured')}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                filterTab === 'unconfigured'
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-muted hover:text-text'
              }`}
            >
              Needs Setup
            </button>
          </div>
        </div>

        {/* Content Section */}
        {loading ? (
          <div className="space-y-3 rounded-2xl border border-border bg-card p-8 text-center">
            <div className="mx-auto h-2 max-w-xs overflow-hidden rounded-full bg-border-subtle">
              <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
            </div>
            <p className="text-sm text-muted">Loading catalogue garments…</p>
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center">
            <Shirt className="mx-auto h-12 w-12 text-muted/60" />
            <h3 className="mt-3 font-semibold text-text">No matching apparel</h3>
            <p className="mt-1 text-sm text-muted">
              {query
                ? `No products matched "${query}". Try another search term.`
                : 'No products found under this filter.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {filteredRows.map((row) => {
              const template = row.metadata?.team_template
              const isConfigured = Boolean(template)
              const fieldsCount = Array.isArray(template?.fields) ? template.fields.length : 0

              return (
                <Link
                  key={row.id}
                  to={`/admin/team-templates/${row.id}`}
                  className="group flex flex-col justify-between rounded-2xl border border-border bg-card p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary hover:shadow-soft"
                >
                  <div>
                    <div className="relative mb-3 aspect-square overflow-hidden rounded-xl bg-card">
                      {row.images?.[0] ? (
                        <img
                          src={row.images[0]}
                          alt={row.name}
                          className="h-full w-full object-contain transition-transform duration-500 group-hover:scale-105"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-muted">
                          <Shirt className="h-8 w-8" />
                        </div>
                      )}
                      {isConfigured && (
                        <span className="absolute right-2 top-2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm">
                          Active
                        </span>
                      )}
                    </div>

                    <h3 className="line-clamp-2 text-sm font-semibold text-text group-hover:text-primary">
                      {row.name}
                    </h3>
                  </div>

                  <div className="mt-3 border-t border-border-subtle pt-2.5">
                    {isConfigured ? (
                      <div className="flex items-center justify-between">
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Personalizable
                        </span>
                        <span className="text-[11px] text-muted">
                          {fieldsCount} field{fieldsCount === 1 ? '' : 's'}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between text-xs text-muted">
                        <span className="inline-flex items-center gap-1">
                          <PlusCircle className="h-3.5 w-3.5 text-muted" />
                          Not configured
                        </span>
                        <span className="font-medium text-primary group-hover:underline">Setup</span>
                      </div>
                    )}
                  </div>
                </Link>
              )
            })}
          </div>
        )}

        {/* Pagination */}
        {pages > 1 && (
          <div className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-sm">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:border-primary disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-xs text-muted">
              Page {page + 1} of {pages} · {total} products
            </span>
            <button
              onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
              disabled={page >= pages - 1}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:border-primary disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default AdminTeamTemplatesIndex
