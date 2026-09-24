// Team templates — the picker. /admin/team-templates
//
// The authoring screen is per-product (/admin/team-templates/:productId), which
// on its own means knowing a UUID and typing it into the address bar. This is
// the way in: every shirt/hoodie in the catalogue, which ones are already
// personalizable, and one click through to set one up.
//
// Products are paged server-side rather than fetched whole. PostgREST silently
// caps an unbounded select at 1,000 rows — the Products tab shipped with that
// bug and showed 1,000 of 2,592 while looking perfectly fine (2026-09-08), so
// anything listing this catalogue pages explicitly or it is lying.
import React, { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Search, Shirt, Check } from 'lucide-react'
import { supabase } from '../lib/supabase'

const PAGE_SIZE = 24

interface Row {
  id: string
  name: string
  images: string[] | null
  metadata: Record<string, any> | null
}

const AdminTeamTemplatesIndex: React.FC = () => {
  const [rows, setRows] = useState<Row[]>([])
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    // Narrow columns on purpose: this page needs a name, a thumbnail and
    // whether a template exists. Selecting * here drags every product's full
    // description and SEO blob over the wire for a grid of 24 cards.
    let q = supabase
      .from('products')
      .select('id, name, images, metadata', { count: 'exact' })
      .in('category', ['shirts', 'hoodies'])
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)

    if (query.trim()) q = q.ilike('name', `%${query.trim()}%`)

    const { data, count } = await q
    setRows((data as Row[]) ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }, [page, query])

  useEffect(() => {
    void load()
  }, [load])

  // Reset to the first page whenever the search changes, or a search on page 4
  // silently returns nothing and reads as "no results".
  useEffect(() => {
    setPage(0)
  }, [query])

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="min-h-screen bg-bg p-6 text-text">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex items-center gap-3">
          <Link to="/admin" className="text-muted hover:text-text">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="font-display text-2xl font-bold">Team templates</h1>
            <p className="text-sm text-muted">
              Pick a shirt to make its back personalizable — the customer types a name and number,
              and the press file is drawn from it.
            </p>
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search shirts and hoodies by name…"
            className="w-full rounded-lg border border-primary/30 bg-card py-2 pl-9 pr-3 text-sm"
          />
        </div>

        {loading ? (
          <div className="space-y-2">
            <div className="h-2 w-full overflow-hidden rounded-full bg-card">
              <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
            </div>
            <p className="text-xs text-muted">Loading the catalogue…</p>
          </div>
        ) : rows.length === 0 ? (
          <p className="text-muted">No shirts or hoodies matched.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {rows.map((row) => {
              const hasTemplate = Boolean(row.metadata?.team_template)
              return (
                <Link
                  key={row.id}
                  to={`/imagination-station/team/${row.id}`}
                  className="group rounded-xl border border-primary/20 bg-card p-3 transition-colors hover:border-primary"
                >
                  <div className="mb-2 aspect-square overflow-hidden rounded-lg bg-white">
                    {row.images?.[0] ? (
                      <img src={row.images[0]} alt={row.name} className="h-full w-full object-contain" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-muted">
                        <Shirt className="h-8 w-8" />
                      </div>
                    )}
                  </div>
                  <div className="line-clamp-2 text-sm font-medium group-hover:text-primary">
                    {row.name}
                  </div>
                  {hasTemplate ? (
                    <span className="mt-1 inline-flex items-center gap-1 rounded bg-green-500/15 px-2 py-0.5 text-xs text-green-400">
                      <Check className="h-3 w-3" /> Personalizable
                    </span>
                  ) : (
                    <span className="mt-1 inline-block text-xs text-muted">Not set up</span>
                  )}
                </Link>
              )
            })}
          </div>
        )}

        {pages > 1 && (
          <div className="flex items-center justify-between text-sm">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded border border-primary/30 px-3 py-1 disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-muted">
              Page {page + 1} of {pages} · {total} products
            </span>
            <button
              onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
              disabled={page >= pages - 1}
              className="rounded border border-primary/30 px-3 py-1 disabled:opacity-40"
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
