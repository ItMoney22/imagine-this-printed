import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/SupabaseAuthContext'
import { useToast } from '../hooks/useToast'
import ProductCard from '../components/ProductCard'
import type { Product } from '../types'
import { Sparkles, Star, Truck, ShieldCheck, Settings, X, Search, Check } from 'lucide-react'

const COLLECTION = 'america-250'

// Map a raw products row to the app Product shape (mirrors ProductCatalog).
function mapRow(p: any): Product {
  return {
    id: p.id,
    name: p.name,
    description: p.description || '',
    price: p.price || 0,
    images: p.images || [],
    category: p.category || 'shirts',
    inStock: p.is_active !== false,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    metadata: p.metadata || {},
    isThreeForTwentyFive: p.metadata?.isThreeForTwentyFive || false,
    sizes: p.metadata?.sizes || [],
    colors: p.metadata?.colors || [],
  }
}

const America250: React.FC = () => {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [showManage, setShowManage] = useState(false)
  const gridRef = useRef<HTMLDivElement>(null)

  const loadCollection = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('is_active', true)
        .eq('status', 'active')
        .eq('metadata->>collection', COLLECTION)
        .order('created_at', { ascending: false })
      if (error) throw error
      setProducts((data || []).map(mapRow))
    } catch {
      setProducts([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadCollection()
  }, [loadCollection])

  const scrollToGrid = () => gridRef.current?.scrollIntoView({ behavior: 'smooth' })

  return (
    <div className="min-h-screen bg-bg">
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative w-full overflow-hidden">
        <img
          src="/america-250/hero.webp"
          alt="America's 250th Anniversary — 4th of July Collection"
          className="w-full h-[58vh] min-h-[420px] max-h-[680px] object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0a1733]/85 via-[#0a1733]/45 to-transparent" />
        <div className="absolute inset-0 flex items-center">
          <div className="max-w-7xl mx-auto px-6 w-full">
            <div className="max-w-xl text-white">
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 backdrop-blur text-xs font-semibold tracking-wider uppercase mb-4 border border-white/25">
                <Star size={13} className="text-amber-300" /> 1776 – 2026 · 250 Years
              </span>
              <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-tight drop-shadow-lg">
                Celebrate America's <span className="text-red-400">250th</span>
              </h1>
              <p className="mt-4 text-lg sm:text-xl text-white/90 max-w-md">
                A limited 4th of July collection — wear the milestone. Premium prints, made to order, shipped fast.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <button
                  onClick={scrollToGrid}
                  className="px-7 py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-base shadow-lg shadow-red-900/30 transition-colors"
                >
                  Shop the Collection
                </button>
                <Link
                  to="/imagination-station"
                  className="px-7 py-3 rounded-xl bg-white/15 hover:bg-white/25 backdrop-blur text-white font-semibold text-base border border-white/30 transition-colors flex items-center gap-2"
                >
                  <Sparkles size={16} /> Design Your Own
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Trust strip ──────────────────────────────────────── */}
      <section className="bg-[#0a1733] text-white">
        <div className="max-w-7xl mx-auto px-6 py-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div className="flex items-center justify-center gap-2"><Truck size={16} className="text-amber-300" /> Fast U.S. shipping</div>
          <div className="flex items-center justify-center gap-2"><ShieldCheck size={16} className="text-amber-300" /> Premium made-to-order prints</div>
          <div className="flex items-center justify-center gap-2"><Star size={16} className="text-amber-300" /> Limited 250th-anniversary line</div>
        </div>
      </section>

      {/* ── Story / feature band ─────────────────────────────── */}
      <section className="max-w-7xl mx-auto px-6 py-14">
        <div className="grid md:grid-cols-2 gap-10 items-center">
          <img
            src="/america-250/emblem.webp"
            alt="250 Years commemorative emblem"
            className="w-full rounded-2xl shadow-xl object-cover aspect-square bg-card"
            loading="lazy"
          />
          <div>
            <h2 className="font-display text-3xl font-bold text-text">Two and a half centuries, one statement.</h2>
            <p className="mt-4 text-muted text-lg leading-relaxed">
              This July 4th marks 250 years of independence. Our anniversary line pairs heritage red-white-and-blue
              design with the same studio-quality printing we put on every order — built to last well past the fireworks.
            </p>
            <button
              onClick={scrollToGrid}
              className="mt-6 inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#0a1733] hover:bg-[#13234d] text-white font-semibold transition-colors"
            >
              Browse the line
            </button>
          </div>
        </div>
      </section>

      {/* lifestyle band */}
      <section className="relative">
        <img src="/america-250/lifestyle.webp" alt="4th of July celebration" className="w-full h-[40vh] min-h-[280px] object-cover" loading="lazy" />
        <div className="absolute inset-0 bg-[#0a1733]/35" />
        <div className="absolute inset-0 flex items-center justify-center text-center px-6">
          <h2 className="text-white font-display text-3xl sm:text-4xl font-extrabold drop-shadow-lg max-w-2xl">
            Made for the cookout, the parade, and every red-white-and-blue moment.
          </h2>
        </div>
      </section>

      {/* ── Product grid ─────────────────────────────────────── */}
      <section ref={gridRef} className="max-w-7xl mx-auto px-6 py-16 scroll-mt-20">
        <div className="flex items-end justify-between mb-8 flex-wrap gap-3">
          <div>
            <h2 className="font-display text-3xl font-bold text-text">Shop the 250th Collection</h2>
            <p className="text-muted mt-1">Hand-picked patriotic pieces, ready to print.</p>
          </div>
          {isAdmin && (
            <button
              onClick={() => setShowManage(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg border border-text/15 text-text hover:bg-text/5 transition-colors"
            >
              <Settings size={15} className="text-primary" /> Manage collection
            </button>
          )}
        </div>

        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="aspect-square rounded-xl bg-text/5 animate-pulse" />
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="text-center py-20 border border-dashed border-text/15 rounded-2xl">
            <Star size={36} className="mx-auto text-muted/40 mb-3" />
            <p className="text-text font-medium">The collection is being curated.</p>
            <p className="text-muted text-sm mt-1">
              {isAdmin ? 'Click “Manage collection” to add products.' : 'Check back soon — patriotic drops incoming.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {products.map(p => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        )}
      </section>

      {isAdmin && showManage && (
        <ManageCollectionModal
          onClose={() => { setShowManage(false); loadCollection() }}
        />
      )}
    </div>
  )
}

// ── Admin curation: pick which products belong to the collection ──────────────
const ManageCollectionModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const toast = useToast()
  const [rows, setRows] = useState<{ id: string; name: string; image: string | null; inCollection: boolean }[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      const { data } = await supabase
        .from('products')
        .select('id, name, images, metadata')
        .eq('is_active', true)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(500)
      setRows(
        (data || []).map((p: any) => ({
          id: p.id,
          name: p.name,
          image: Array.isArray(p.images) && p.images.length ? p.images[0] : null,
          inCollection: p.metadata?.collection === COLLECTION,
          metadata: p.metadata || {},
        })) as any,
      )
      setLoading(false)
    })()
  }, [])

  const toggle = async (id: string, next: boolean, metadata: any) => {
    setSavingId(id)
    try {
      const newMeta = { ...(metadata || {}), collection: next ? COLLECTION : null }
      const { error } = await supabase.from('products').update({ metadata: newMeta }).eq('id', id)
      if (error) throw error
      setRows(prev => prev.map(r => (r.id === id ? { ...r, inCollection: next, metadata: newMeta } as any : r)))
    } catch (err: unknown) {
      toast.error('Update failed', err instanceof Error ? err.message : 'Could not update product')
    } finally {
      setSavingId(null)
    }
  }

  const filtered = rows.filter(r => r.name.toLowerCase().includes(search.toLowerCase()))
  const inCount = rows.filter(r => r.inCollection).length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-card border border-text/10 rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[88vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-text/10 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-text">Manage 250th Collection</h2>
            <p className="text-xs text-muted">{inCount} product{inCount === 1 ? '' : 's'} in the collection</p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-text transition-colors" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-3 border-b border-text/10 shrink-0">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search products…"
              className="w-full pl-9 pr-3 py-2 text-sm bg-bg border border-text/10 rounded-lg text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
        </div>
        <div className="overflow-y-auto flex-1 px-3 py-2">
          {loading ? (
            <p className="text-center text-muted text-sm py-10">Loading products…</p>
          ) : filtered.length === 0 ? (
            <p className="text-center text-muted text-sm py-10">No products found.</p>
          ) : (
            filtered.map(r => (
              <button
                key={r.id}
                onClick={() => toggle(r.id, !r.inCollection, (r as any).metadata)}
                disabled={savingId === r.id}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors disabled:opacity-50 ${
                  r.inCollection ? 'bg-primary/10' : 'hover:bg-text/5'
                }`}
              >
                {r.image ? (
                  <img src={r.image} alt="" className="w-10 h-10 rounded object-cover shrink-0" />
                ) : (
                  <div className="w-10 h-10 rounded bg-text/10 shrink-0" />
                )}
                <span className="flex-1 text-sm text-text truncate">{r.name}</span>
                <span
                  className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 ${
                    r.inCollection ? 'bg-primary border-primary text-white' : 'border-text/20'
                  }`}
                >
                  {r.inCollection && <Check size={13} />}
                </span>
              </button>
            ))
          )}
        </div>
        <div className="px-5 py-3 border-t border-text/10 shrink-0 flex justify-end">
          <button onClick={onClose} className="px-5 py-2 text-sm rounded-lg bg-primary text-white font-medium hover:bg-primary/90 transition-colors">
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

export default America250
