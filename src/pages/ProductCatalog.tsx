import React, { useState, useEffect } from 'react'
import { useParams, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import ProductCard from '../components/ProductCard'
import { canonicalCategoryOf, categoryValuesFor } from '../lib/product-kind'
import type { Product } from '../types'

// Products per page. Chosen as a multiple of the 3-column xl grid so the
// last row on desktop doesn't dangle with 1-2 orphaned cards.
const PAGE_SIZE = 24

function mapProductRow(p: any): Product {
  return {
    // isUserSubmitted below isn't a declared Product field (ProductCard.tsx
    // reads it via `(product as any).isUserSubmitted`) — cast at the return,
    // same as this file's previous `as Product[]`, so it still compiles.
    id: p.id,
    name: p.name,
    description: p.description || '',
    price: p.price || 0,
    images: p.images || [],
    // Classify by kind (column → metadata.product_template fallback) so
    // metal/3D products with a null category stop landing under T-Shirts.
    category: canonicalCategoryOf({ category: p.category, metadata: p.metadata }) as Product['category'],
    inStock: p.is_active !== false,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    metadata: p.metadata || {},
    isThreeForTwentyFive: p.metadata?.isThreeForTwentyFive || false,
    // sizes/colors live on the columns (set at approval); metadata fallback for legacy rows
    sizes: p.sizes || p.metadata?.sizes || [],
    colors: p.colors || p.metadata?.colors || [],
    isUserSubmitted: p.metadata?.is_user_submitted || false
  } as Product
}

// Unapproved user-submitted designs must never leave the server — this used
// to be a client-side `.filter(Boolean)` run AFTER the full row (name,
// image, price, everything) had already been sent to the browser. Written as
// an explicit "keep if NOT flagged unapproved" OR, not a negated AND: most
// catalog rows never set metadata.is_user_submitted at all, and Postgres's
// 3-valued NULL logic makes `NOT (a AND b)` silently drop rows where a/b are
// simply unset — this would have hidden the entire non-user-submitted catalog.
function applyApprovalFilter(query: any) {
  return query.or(
    'metadata->>is_user_submitted.is.null,metadata->>is_user_submitted.eq.false,metadata->>approved_by_admin.eq.true'
  )
}

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

const ProductCatalog: React.FC = () => {
  const { category } = useParams<{ category?: string }>()
  const location = useLocation()
  const [selectedCategory, setSelectedCategory] = useState<string>(category || 'all')
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [sortBy, setSortBy] = useState<'newest' | 'price-low' | 'price-high' | 'popular'>('newest')
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
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

  const categories = [
    {
      id: 'all', name: 'All Products', icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
        </svg>
      )
    },
    {
      id: 'dtf-transfers', name: 'DTF Transfers', icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
        </svg>
      )
    },
    {
      id: 'shirts', name: 'T-Shirts', icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 2L2 6v3h4v13h12V9h4V6l-4-4h-4l-2 2-2-2H6z" />
        </svg>
      )
    },
    {
      id: 'tumblers', name: 'Tumblers', icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3h6l1 2h2a1 1 0 011 1v1H5V6a1 1 0 011-1h2l1-2zM5 7l1 14a2 2 0 002 2h8a2 2 0 002-2l1-14H5z" />
        </svg>
      )
    },
    {
      id: 'hoodies', name: 'Hoodies', icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 2C8 2 6 4 6 4L2 8v4h4v10h12V12h4V8l-4-4s-2-2-6-2zm0 0v6" />
        </svg>
      )
    },
    {
      id: '3d-prints', name: '3D Prints', icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5" />
        </svg>
      )
    },
    {
      id: 'metal-art', name: 'Metal Art', icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm3 2h10v7l-3-3-4 4-3-2v-6z" />
        </svg>
      )
    }
  ]

  useEffect(() => {
    if (category) {
      setSelectedCategory(category)
    }
  }, [category])

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const getCategoryCount = (catId: string) =>
    catId === 'all' ? catalogTotalCount : (categoryCounts[catId] || 0)

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header Section */}
      <div className="bg-gradient-to-br from-purple-600 via-purple-700 to-pink-600 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute inset-0" style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          }} />
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 relative">
          <h1 className="text-3xl sm:text-4xl font-display font-bold text-white mb-2">Product Catalog</h1>
          <p className="text-purple-100">Browse our collection of custom printing products</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Sidebar */}
          <div className="lg:w-72 flex-shrink-0">
            <div className="bg-white rounded-2xl shadow-soft border border-slate-100 overflow-hidden sticky top-24">
              <div className="px-5 py-4 border-b border-slate-100">
                <h3 className="text-lg font-display font-bold text-slate-900">Categories</h3>
              </div>
              <div className="p-3">
                {categories.map((cat) => {
                  const count = getCategoryCount(cat.id)
                  return (
                    <button
                      key={cat.id}
                      onClick={() => setSelectedCategory(cat.id)}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all mb-1 ${selectedCategory === cat.id
                        ? 'bg-purple-600 text-white shadow-lg shadow-purple-500/25'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                        }`}
                    >
                      <span className={selectedCategory === cat.id ? 'text-purple-200' : 'text-slate-400'}>
                        {cat.icon}
                      </span>
                      <span className="flex-1 text-left font-medium">{cat.name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${selectedCategory === cat.id
                        ? 'bg-white/20 text-white'
                        : 'bg-slate-100 text-slate-500'
                        }`}>
                        {count}
                      </span>
                    </button>
                  )
                })}
              </div>

              {/* Quick Stats */}
              <div className="px-5 py-4 border-t border-slate-100 bg-slate-50/50">
                <div className="grid grid-cols-2 gap-3">
                  <div className="text-center">
                    <p className="text-2xl font-display font-bold text-slate-900">{catalogTotalCount}</p>
                    <p className="text-xs text-slate-500">Total Products</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-display font-bold text-purple-600">{categories.length - 1}</p>
                    <p className="text-xs text-slate-500">Categories</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="flex-1 min-w-0">
            {/* Toolbar */}
            <div className="bg-white rounded-xl shadow-soft border border-slate-100 p-4 mb-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <p className="text-slate-600">
                    {loading ? (
                      <span className="flex items-center gap-2">
                        <span className="animate-pulse">Loading...</span>
                      </span>
                    ) : (
                      <>
                        <span className="font-semibold text-slate-900">{totalCount}</span>
                        <span className="text-slate-500"> products</span>
                        {selectedCategory !== 'all' && (
                          <span className="text-slate-400"> in {categories.find(c => c.id === selectedCategory)?.name}</span>
                        )}
                      </>
                    )}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  {/* Search */}
                  <div className="relative flex-1 sm:flex-none sm:w-64">
                    <svg className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
                    </svg>
                    <input
                      type="search"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search products…"
                      className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
                    />
                  </div>

                  {/* Sort Dropdown */}
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as any)}
                    className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
                  >
                    <option value="newest">Newest First</option>
                    <option value="price-low">Price: Low to High</option>
                    <option value="price-high">Price: High to Low</option>
                    <option value="popular">Most Popular</option>
                  </select>

                  {/* View Toggle */}
                  <div className="flex items-center bg-slate-100 rounded-lg p-1">
                    <button
                      onClick={() => setViewMode('grid')}
                      className={`p-2 rounded-md transition-colors ${viewMode === 'grid'
                        ? 'bg-white text-purple-600 shadow-sm'
                        : 'text-slate-400 hover:text-slate-600'
                        }`}
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => setViewMode('list')}
                      className={`p-2 rounded-md transition-colors ${viewMode === 'list'
                        ? 'bg-white text-purple-600 shadow-sm'
                        : 'text-slate-400 hover:text-slate-600'
                        }`}
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Products Grid/List */}
            {loading ? (
              <div className="flex flex-col items-center justify-center py-20">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mb-4"></div>
                <p className="text-slate-500">Loading products...</p>
              </div>
            ) : products.length > 0 ? (
              <>
                <div className={
                  viewMode === 'grid'
                    ? 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6'
                    : 'space-y-4'
                }>
                  {products.map((product, index) => (
                    <div
                      key={product.id}
                      className="animate-fade-in"
                      style={{ animationDelay: `${index * 50}ms` }}
                    >
                      <ProductCard
                        product={product}
                        showSocialBadges={true}
                      />
                    </div>
                  ))}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="mt-8 flex items-center justify-center gap-4">
                    <button
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page <= 1}
                      className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      Previous
                    </button>
                    <span className="text-sm text-slate-600">
                      Page {page} of {totalPages}
                    </span>
                    <button
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page >= totalPages}
                      className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-12 text-center">
                <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-slate-100 flex items-center justify-center">
                  <svg className="w-10 h-10 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                </div>
                <h3 className="text-xl font-display font-bold text-slate-900 mb-2">No products found</h3>
                <p className="text-slate-500 mb-6">
                  {searchQuery.trim()
                    ? `No products match "${searchQuery.trim()}"${selectedCategory !== 'all' ? ` in ${categories.find(c => c.id === selectedCategory)?.name}` : ''}.`
                    : selectedCategory === 'all'
                      ? "We're working on adding new products. Check back soon!"
                      : `No products in the "${categories.find(c => c.id === selectedCategory)?.name}" category yet.`
                  }
                </p>
                {searchQuery.trim() && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="px-6 py-2.5 bg-purple-600 text-white rounded-xl hover:bg-purple-700 font-medium transition-colors mr-3"
                  >
                    Clear Search
                  </button>
                )}
                {selectedCategory !== 'all' && (
                  <button
                    onClick={() => setSelectedCategory('all')}
                    className="px-6 py-2.5 bg-purple-600 text-white rounded-xl hover:bg-purple-700 font-medium transition-colors"
                  >
                    View All Products
                  </button>
                )}
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  )
}

export default ProductCatalog
