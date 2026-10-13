// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import source from './WholesalePortal.tsx?raw'
import WholesalePortal from './WholesalePortal'

// One stable user object: the portal re-checks access whenever `user` changes identity.
const auth = vi.hoisted(() => ({ user: { id: 'u1' } }))
vi.mock('../context/SupabaseAuthContext', () => ({ useAuth: () => auth }))
vi.mock('../context/CartContext', () => ({ useCart: () => ({ addToCart: vi.fn() }) }))
vi.mock('../components/GuestGate', () => ({ useGuestGate: () => ({ startAccount: vi.fn() }) }))
vi.mock('../lib/api', () => ({
  apiFetch: vi.fn().mockResolvedValue({
    status: 'approved',
    account: {
      companyName: 'Test Shop', businessType: null, taxId: null, tier: 'bronze', discountRate: 0.15,
      creditLimit: 0, paymentTerms: 0, totalOrders: 0, totalSpent: 0, averageOrderValue: 0,
      lastOrderDate: null, contactEmail: null, contactPhone: null, recentOrders: [],
    },
  }),
}))

afterEach(() => cleanup())

// Guard: ITP is the only seller. The portal listed two invented vendors
// ("Premium Apparel Co", "Quality Prints Ltd") and a stock unsplash photo on the
// live site until 2026-10-13 (task 67755f9a); this fails if either comes back.
describe('WholesalePortal invented data', () => {
  it('has no hard-coded vendor names or stock photo hosts', () => {
    expect(source).not.toMatch(/Premium Apparel|Quality Prints|All Vendors|images\.unsplash\.com/i)
  })

  it('an approved account sees the product filters without a vendor filter, and no stock photo', async () => {
    const { container } = render(<MemoryRouter><WholesalePortal /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: /Products/ }))
    expect(await screen.findByText('Filter Products')).toBeTruthy()
    expect(container.querySelectorAll('select')).toHaveLength(2)
    expect(screen.queryByText('All Vendors')).toBeNull()
    expect(screen.getByText('Premium Cotton T-Shirt - Bulk Pack')).toBeTruthy()
    expect(container.querySelector('img')).toBeNull()
  })
})
