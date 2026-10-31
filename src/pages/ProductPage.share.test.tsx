// @vitest-environment jsdom
// ProductPage + the Share link (task ebf7dec0): Share only on a published
// product, /p/ short links open the product, dead links land on the catalog.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ProductPage from './ProductPage'

const h = vi.hoisted(() => ({
  find: vi.fn(),
  info: vi.fn()
}))

vi.mock('../lib/product-link', () => ({ findProductByKey: h.find }))
vi.mock('../lib/supabase', () => {
  const q = { select: () => q, eq: () => q, in: async () => ({ data: [], error: null }) }
  return { supabase: { from: () => q } }
})
vi.mock('../context/CartContext', () => ({ useCart: () => ({ addToCart: vi.fn() }) }))
vi.mock('../context/SupabaseAuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../hooks/useToast', () => {
  const toast = { info: h.info, success: vi.fn(), error: vi.fn(), warning: vi.fn() }
  return { useToast: () => toast }
})
vi.mock('../components/VirtualTryOn', () => ({ default: () => null }))
vi.mock('../components/product/YouMayAlsoLike', () => ({ YouMayAlsoLike: () => null }))
vi.mock('../components/reviews/RealReviews', () => ({ ProductSocialProof: () => null }))
vi.mock('../components/ProtectedImage', () => ({ default: () => null }))

const ROW = {
  id: '9c3b3d19-72b1-4fbb-9a0c-148e2a486298',
  slug: '1d2b8a23-0cdd-4dd3-b010-ba2ce3a7bc77',
  name: 'Folgers Coffee Racing Legend T-Shirt | Vintage Stock Car Tee',
  description: 'A racing tee.',
  price: 25,
  category: 'shirts',
  images: [],
  metadata: {},
  sizes: ['S', 'M', 'L'],
  colors: ['black']
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/product/:id" element={<ProductPage />} />
        <Route path="/p/:code" element={<ProductPage />} />
        <Route path="/catalog" element={<p>catalog page</p>} />
      </Routes>
    </MemoryRouter>
  )
}

afterEach(cleanup)

beforeEach(() => {
  h.find.mockReset()
  h.info.mockReset()
})

describe('ProductPage share link', () => {
  it('opens a /p/ short link and offers Share on a published product', async () => {
    h.find.mockResolvedValue({ row: { ...ROW, status: 'active', approved: true }, replaced: false })
    renderAt('/p/folgers-coffee-racing-9c3b3d19')
    expect(await screen.findByRole('heading', { level: 1, name: /Folgers Coffee Racing/ })).toBeTruthy()
    expect(h.find).toHaveBeenCalledWith('folgers-coffee-racing-9c3b3d19', { short: true })
    expect(screen.getByRole('button', { name: /share/i })).toBeTruthy()
  })

  it('offers no Share on an unpublished product (a draft its owner is viewing)', async () => {
    h.find.mockResolvedValue({ row: { ...ROW, status: 'draft', approved: false }, replaced: false })
    renderAt(`/product/${ROW.id}`)
    expect(await screen.findByRole('heading', { level: 1, name: /Folgers Coffee Racing/ })).toBeTruthy()
    expect(h.find).toHaveBeenCalledWith(ROW.id, { short: false })
    expect(screen.queryByRole('button', { name: /share/i })).toBeNull()
  })

  it('sends a dead link to the catalog with a notice, never "Product Not Found"', async () => {
    h.find.mockResolvedValue(null)
    renderAt('/p/gone-tee-deadbeef')
    expect(await screen.findByText('catalog page')).toBeTruthy()
    expect(h.info).toHaveBeenCalledWith("That item isn't in the shop anymore", "Here's everything that is.", 7000)
    expect(screen.queryByText('Product Not Found')).toBeNull()
  })

  it('sends a replaced product link on to the product that took over', async () => {
    h.find.mockResolvedValue({ row: { ...ROW, slug: 'folgers-racing-tee', status: 'active', approved: true }, replaced: true })
    render(
      <MemoryRouter initialEntries={['/product/old-folgers-tee']}>
        <Routes>
          <Route path="/product/:id" element={<ProductPage />} />
        </Routes>
      </MemoryRouter>
    )
    await waitFor(() => expect(h.find).toHaveBeenCalledWith('folgers-racing-tee', { short: false }))
  })
})
