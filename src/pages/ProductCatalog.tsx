import React, { useState, useEffect } from 'react'
import { useParams, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Search, ChevronLeft, ChevronRight, PackageSearch } from 'lucide-react'
import ProductCard from '../components/ProductCard'
import { SHOP_PLACE } from '../config/business-info'
import './catalog.css'
import { canonicalCategoryOf, categoryValuesFor } from '../lib/product-kind'
import { mapProductRow } from '../lib/storefront-row'
// The approval predicate now lives in the shared visibility module so the
// catalog and the recommendation widget cannot answer "is this sellable?"
// differently again — they did, and drafts leaked into recommendations.
import { applyApprovalFilter } from '../lib/product-visibility'
import type { Product } from '../types'

// Products per page. Chosen as a multiple of the 3-column xl grid so the
// last row on desktop doesn't dangle with 1-2 orphaned cards.
const PAGE_SIZE = 24

// Server-side mirror of canonicalCategoryOf (src/lib/product-kind.ts). Metal
// and 3D-print products often carry a null `category` column and rely on
// metadata.product_template/category instead, so those two buckets match on
// either signal. Apparel-style categories match against every raw value
// that canonicalCategoryOf's CATEGORY_ALIASES folds into that canonical id
// (via categoryValuesFor) — this is what lets a legacy/in-flight vendor
// category like `lifestyle` or `gaming` still land under the T-Shirts tab
// instead of only "All Products".
function applyCategoryFilter(query: any, categoryId: string) {
  if (categoryId === 'all') return query
  if (categoryId === 'metal-art') {
    return query.or(
      'category.ilike.%metal%,metadata->>product_template.ilike.%metal%,metadata->>product_template.ilike.%wall%,metadata->>category.ilike.%metal%,metadata->>category.ilike.%wall%'
    )
  }
  if (categoryId === '3d-prints') {
    return query.or(
      'category.ilike.%3d%,category.ilike.%toy%,metadata->>product_template.ilike.%3d%,metadata->>product_template.ilike.%toy%,metadata->>category.ilike.%3d%,metadata->>category.ilike.%toy%'
    )
  }
  // Blank garments (sold as-is, no print) — seeded with metadata.garment.blank
  // = true / legacy metadata.blank_only. A metadata-only bucket, not a
  // products.category value, so it never splits rows out of the shirts tab.
  if (categoryId === 'blanks') {
    return query.or('metadata->garment->>blank.eq.true,metadata->>blank_only.eq.true')
  }
  return query.in('category', categoryValuesFor(categoryId))
}

// "Popular" used to sort by metadata.viewCount — a JSONB field that's rarely
// populated and can't be ordered server-side with a syntax this pass could
// verify against a live Supabase instance. `is_featured` is a real, indexed
// boolean column (idx_products_is_featured), so it's used as the server-safe
// stand-in: featured items first, then newest. Documented simplification, not
// a silent behavior swap.
//
// NOTE: this was written as `featured`, which does not exist on the live table
// — Postgres answers `42703 column products.featured does not exist / Perhaps
// you meant "products.is_featured"`. The 001_initial_schema.sql baseline
// declares `featured`, but live drifted to `is_featured`, so the file was never
// the truth here. Verified against live 2026-07-29.
function applySort(query: any, sortBy: string) {
  switch (sortBy) {
    case 'price-low':
      return query.order('price', { ascending: true })
    case 'price-high':
      return query.order('price', { ascending: false })
    case 'popular':
      return query.order('is_featured', { ascending: false }).order('created_at', { ascending: false })
    case 'newest':
    default:
      return query.order('created_at', { ascending: false })
  }
}

// Old links (/catalog/t-shirts, /catalog/tees...) resolve to the one real
// category id, so a bookmark never lands on a blank, unfiltered page.
function normalizeCategorySlug(slug?: string): string {
  if (!slug) return 'all'
  const s = slug.toLowerCase().trim()
  return s === 'all' ? 'all' : canonicalCategoryOf({ category: s as Product['category'], metadata: {} })
}

const ProductCatalog: React.FC = () => {
  const { category } = useParams<{ category?: string }>()
  const location = useLocation()
  const [selectedCategory, setSelectedCategory] = useState<string>(normalizeCategorySlug(category))
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState<'newest' | 'price-low' | 'price-high' | 'popular'>('newest')
  // ?q= comes from the phone header search (task 5e10e099).
  const [searchQuery, setSearchQuery] = useState(() => new URLSearchParams(location.search).get('q')?.trim() || '')
  const [debouncedSearch, setDebouncedSearch] = useState(() => new URLSearchParams(location.search).get('q')?.trim() || '')
  useEffect(() => {
    const q = new URLSearchParams(location.search).get('q')?.trim() || ''
    if (q) setSearchQuery(q)
  }, [location.search])
  const [page, setPage] = useState(1)
  // Server-computed count for the CURRENT category+search filter (drives the
  // toolbar count + pagination), distinct from catalogTotalCount below.
  const [totalCount, setTotalCount] = useState(0)
  // Approval-filtered, category-independent count used for the sidebar
  // "Total Products" stat and the per-category pill badges.
  const [catalogTotalCount, setCatalogTotalCount] = useState(0)
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({})

  // Debounce free-text search so typing doesn't fire a query per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300)
    return () => clearTimeout(t)
  }, [searchQuery])

  // Any filter/sort change starts the user back on page 1. A small amount of
  // double-fetch (this effect + the loadProducts effect below both firing)
  // is the tradeoff for keeping page-reset simple — cheap against a 24-row
  // paginated query, unlike the full-catalog fetch this replaces.
  useEffect(() => {
    setPage(1)
  }, [selectedCategory, debouncedSearch, sortBy])

  // Load products from Supabase - reload when navigating to this page or
  // when the category/search/sort/page changes.
  useEffect(() => {
    loadProducts()
  }, [location.pathname, selectedCategory, debouncedSearch, sortBy, page])

  // Category pill counts + sidebar total load once — they're independent of
  // the current page/search and don't need to refetch on every filter change.
  useEffect(() => {
    loadCategoryCounts()
  }, [])

  const loadProducts = async () => {
    try {
      setLoading(true)
      const from = (page - 1) * PAGE_SIZE
      const to = from + PAGE_SIZE - 1

      let query = supabase
        .from('products')
        .select(
          // `is_featured`, NOT `featured` — the latter does not exist on the live
          // table, and selecting it made this whole query 400, which the catch
          // below turned into an empty catalog while the sidebar counts (which
          // select only `id`) kept reporting the real totals.
          'id, name, description, price, images, category, is_active, created_at, updated_at, metadata, sizes, colors, is_featured',
          { count: 'exact' }
        )
        .eq('status', 'active')
        .eq('is_active', true)

      query = applyApprovalFilter(query)
      query = applyCategoryFilter(query, selectedCategory)

      if (debouncedSearch) {
        const q = debouncedSearch.replace(/[%_]/g, '')
        query = query.or(`name.ilike.%${q}%,description.ilike.%${q}%`)
      }

      query = applySort(query, sortBy).range(from, to)

      const { data, error, count } = await query
      if (error) throw error

      setProducts((data || []).map(mapProductRow))
      setTotalCount(count || 0)
    } catch (error) {
      console.error('Error loading products:', error)
      setProducts([])
      setTotalCount(0)
    } finally {
      setLoading(false)
    }
  }

  const loadCategoryCounts = async () => {
    try {
      const ids = categories.filter(c => c.id !== 'all').map(c => c.id)
      const [totalResult, ...perCategoryResults] = await Promise.all([
        applyApprovalFilter(
          supabase.from('products').select('id', { count: 'exact', head: true }).eq('status', 'active').eq('is_active', true)
        ),
        ...ids.map(id =>
          applyCategoryFilter(
            applyApprovalFilter(
              supabase.from('products').select('id', { count: 'exact', head: true }).eq('status', 'active').eq('is_active', true)
            ),
            id
          )
        )
      ])

      if (totalResult.error) throw totalResult.error
      setCatalogTotalCount(totalResult.count || 0)

      const counts: Record<string, number> = {}
      ids.forEach((id, index) => {
        const result = perCategoryResults[index]
        counts[id] = result.error ? 0 : result.count || 0
        if (result.error) console.error(`Error counting category "${id}":`, result.error)
      })
      setCategoryCounts(counts)
    } catch (error) {
      console.error('Error loading category counts:', error)
    }
  }

  // Shelf pills (approved mock c71ae9d0): every shelf the shop sells from,
  // with its live count. Order = how a shopper thinks, not the old sidebar's.
  const categories: { id: string; name: string }[] = [
    { id: 'all', name: 'All' },
    { id: 'shirts', name: 'T-Shirts' },
    { id: 'hoodies', name: 'Hoodies' },
    { id: '3d-prints', name: '3D Prints' },
    { id: 'dtf-transfers', name: 'DTF Transfers' },
    { id: 'metal-art', name: 'Metal Art' },
    { id: 'tumblers', name: 'Tumblers' },
    // Metadata-only bucket: blank garments sold as-is (metadata.garment.blank).
    { id: 'blanks', name: 'Blank Tees' },
  ]

  useEffect(() => {
    if (category) {
      setSelectedCategory(normalizeCategorySlug(category))
    }
  }, [category])

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const getCategoryCount = (catId: string) =>
    catId === 'all' ? catalogTotalCount : (categoryCounts[catId] || 0)

  // A category with nothing in it is not worth a click. Counts arrive async, so
  // until they do every category shows; once they have, empty ones drop out
  // (the selected one stays, so the page never loses its own filter).
  const countsLoaded = Object.keys(categoryCounts).length > 0
  const visibleCategories = categories.filter(
    c => c.id === 'all' || c.id === selectedCategory || !countsLoaded || getCategoryCount(c.id) > 0
  )
  // Never render a blank category name: fall back to the slug, title-cased.
  const selectedCategoryName =
    categories.find(c => c.id === selectedCategory)?.name ||
    selectedCategory.replace(/[-_]+/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase())

  const pageButton = 'min-w-[2.75rem] h-11 px-4 inline-flex items-center justify-center gap-1.5 rounded-full border border-border bg-card text-sm font-semibold text-text hover:border-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors'

  return (
    <div className="min-h-screen bg-bg">
      {/* Banner: the shop, where it is, and the search — products start right under it. */}
      <section className="relative overflow-hidden bg-bg-warm">
        <img
          src="/catalog/hero.webp"
          alt=""
          className="absolute inset-0 w-full h-full object-cover object-left sm:object-[70%_center]"
          width={1600}
          height={550}
        />
        <div className="absolute inset-0 catalog-fade" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-14 lg:py-16">
          <p className="font-display italic text-sm sm:text-base text-text-secondary mb-1">
            Printed to order in {SHOP_PLACE.town}, {SHOP_PLACE.stateName}
          </p>
          <h1 className="font-display font-bold uppercase text-4xl sm:text-6xl leading-[0.95] text-text">
            Shop
            <span className="block text-primary">everything</span>
          </h1>
          <p className="text-text-secondary text-sm sm:text-base mt-3 max-w-xs sm:max-w-md">
            Shirts, hoodies, 3D prints, transfers and blank tees.
          </p>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-8">
        {/* Search + sort */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
          <div className="relative flex-1 sm:max-w-md sm:ml-auto sm:order-2">
            <Search className="w-4 h-4 text-muted absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search shirts, toys, transfers"
              aria-label="Search products"
              className="w-full h-11 pl-10 pr-4 rounded-full border border-border bg-card text-base sm:text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div className="flex items-center justify-between gap-3 sm:order-1">
          <p className="text-sm text-muted">
            {loading ? 'Loading products' : (
              <>
                <span className="font-semibold text-text">{totalCount}</span> products
                {selectedCategory !== 'all' && <> in {selectedCategoryName}</>}
              </>
            )}
          </p>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              aria-label="Sort"
              className="sm:hidden shrink-0 h-10 px-3 rounded-full border border-border bg-card text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="newest">Newest</option>
              <option value="price-low">Price: low to high</option>
              <option value="price-high">Price: high to low</option>
              <option value="popular">Most popular</option>
            </select>
          </div>
        </div>

        {/* Shelf pills (scroll sideways on a phone) + sort */}
        <div className="flex items-center gap-3 mb-5 sm:mb-7">
          <div className="flex-1 min-w-0 flex gap-2 overflow-x-auto catalog-pills -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap" role="tablist" aria-label="Shop by category">
            {visibleCategories.map((cat) => {
              const on = selectedCategory === cat.id
              return (
                <button
                  key={cat.id}
                  role="tab"
                  aria-selected={on}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`shrink-0 h-10 px-4 rounded-full border text-sm font-semibold whitespace-nowrap transition-colors ${
                    on ? 'bg-primary border-primary text-white' : 'bg-card border-border text-text hover:border-primary'
                  }`}
                >
                  {cat.name}
                  <span className={`ml-1.5 text-xs font-medium ${on ? 'text-white/80' : 'text-muted'}`}>{getCategoryCount(cat.id)}</span>
                </button>
              )
            })}
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            aria-label="Sort"
            className="hidden sm:block shrink-0 h-10 px-3 rounded-full border border-border bg-card text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="newest">Newest</option>
            <option value="price-low">Price: low to high</option>
            <option value="price-high">Price: high to low</option>
            <option value="popular">Most popular</option>
          </select>
        </div>

        {/* Products: whole cards, photo + name + price + Add to cart */}
        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-5" aria-busy="true">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="bg-card rounded-xl border border-border overflow-hidden animate-pulse">
                <div className="aspect-square bg-border-subtle" />
                <div className="p-4 space-y-2">
                  <div className="h-4 bg-border-subtle rounded w-3/4" />
                  <div className="h-4 bg-border-subtle rounded w-1/3" />
                  <div className="h-9 bg-border-subtle rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : products.length > 0 ? (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-5">
              {products.map((product) => (
                <ProductCard key={product.id} product={product} showSocialBadges={false} compact />
              ))}
            </div>

            {totalPages > 1 && (
              <div className="mt-10 flex items-center justify-center gap-3">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className={pageButton}>
                  <ChevronLeft className="w-4 h-4" /> Previous
                </button>
                <span className="text-sm text-text-secondary px-2">Page {page} of {totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className={`${pageButton} !bg-primary !border-primary !text-white`}>
                  Next <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="bg-card rounded-3xl border border-border shadow-soft p-10 sm:p-12 text-center">
            <PackageSearch className="w-12 h-12 mx-auto mb-4 text-muted" strokeWidth={1.5} />
            <h3 className="font-display text-2xl text-text mb-2">No products found</h3>
            <p className="text-text-secondary mb-6">
              {searchQuery.trim()
                ? `Nothing matches "${searchQuery.trim()}"${selectedCategory !== 'all' ? ` in ${selectedCategoryName}` : ''}.`
                : `Nothing in ${selectedCategoryName} right now.`}
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              {searchQuery.trim() && (
                <button onClick={() => setSearchQuery('')} className="btn-primary !py-3">
                  Clear search
                </button>
              )}
              {selectedCategory !== 'all' && (
                <button onClick={() => setSelectedCategory('all')} className="btn-primary !py-3">
                  Show everything
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default ProductCatalog
