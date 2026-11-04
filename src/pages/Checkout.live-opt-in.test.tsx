// @vitest-environment jsdom
// The checkout box for the live printer cam (task 528180f9): it shows on a cart
// with the customer's own print, is off by default, and what it says always
// reaches the order, whenever the customer ticks it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const LABEL = 'Let my family watch my Mini-Me print live on a private link'
const ORDER = '11111111-1111-4111-8111-111111111111'
const INTENT = '/api/stripe/checkout-payment-intent'

const ownPrint = { id: 'line-1', quantity: 1, product: { id: '3d-print-abc', name: 'Custom figurine', price: 50, images: [], metadata: {} } }
const shirt = { id: 'line-2', quantity: 1, product: { id: '44444444-4444-4444-8444-444444444444', name: 'A shirt', price: 25, images: [], metadata: {} } }

let items: any[] = []
const apiFetch = vi.fn()

vi.mock('../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }))
vi.mock('../context/CartContext', () => ({
  useCart: () => ({
    state: { items, total: 50 },
    clearCart: vi.fn(),
    appliedCoupon: null,
    discount: 0,
    finalTotal: 50,
    applyCoupon: vi.fn(),
    removeCoupon: vi.fn(),
    couponLoading: false,
    restoreFromOrder: vi.fn(),
  }),
}))
const user = { id: 'user-1', email: 'owner@example.com', firstName: 'A', lastName: 'Customer', wallet: { itcBalance: 0 } }
vi.mock('../context/SupabaseAuthContext', () => ({ useAuth: () => ({ user, refreshProfile: vi.fn() }) }))
vi.mock('../hooks/useToast', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }))
vi.mock('@stripe/stripe-js', () => ({ loadStripe: () => Promise.resolve(null) }))
vi.mock('@stripe/react-stripe-js', () => ({
  Elements: () => null,
  PaymentElement: () => null,
  ExpressCheckoutElement: () => null,
  useStripe: () => null,
  useElements: () => null,
}))
vi.mock('../utils/shipping-calculator', async importOriginal => {
  const rate = { id: 'std', name: 'Standard', provider: 'usps', amount: 5, currency: 'USD', estimatedDays: 3, selected: true, type: 'shipping' }
  return {
    ...(await importOriginal<any>()),
    shippingCalculator: {
      calculateShipping: async () => ({ rates: [rate], selectedRate: rate, freeShippingThreshold: 75, isFreeShipping: false }),
    },
  }
})

const { default: Checkout } = await import('./Checkout')

const draft = (metadata: Record<string, any> = {}) => ({
  order: {
    id: ORDER,
    user_id: user.id,
    payment_status: 'pending',
    payment_intent_id: 'pi_test',
    customer_email: user.email,
    shipping_address: { firstName: 'A', lastName: 'Customer', email: user.email, address: '1 Main St', city: 'Rome', state: 'GA', zipCode: '30161', country: 'US' },
    metadata,
  },
})

/** Every payment-intent call so far, in order. */
const intentCalls = () =>
  apiFetch.mock.calls.filter(([path]) => path === INTENT).map(([, init]) => JSON.parse((init as RequestInit).body as string))

/** Opens an existing draft, which carries the address, so the card step runs by itself. */
const openDraft = (metadata: Record<string, any> = {}) => {
  apiFetch.mockImplementation(async (path: string) =>
    path === INTENT ? { clientSecret: 'pi_test_secret', paymentIntentId: 'pi_test', orderId: ORDER } : draft(metadata),
  )
  render(
    <MemoryRouter initialEntries={[`/checkout?order=${ORDER}`]}>
      <Checkout />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  apiFetch.mockReset()
  items = [ownPrint]
})

afterEach(cleanup)

describe('checkout: live printer box', () => {
  it('shows on a cart with the customer\'s own print, unticked', async () => {
    openDraft()
    const box = (await screen.findByLabelText(LABEL)) as HTMLInputElement
    expect(box.type).toBe('checkbox')
    expect(box.checked).toBe(false)
    expect(box.required).toBe(false)
  })

  it('stays away from a cart with nothing the customer had printed', async () => {
    items = [shirt]
    openDraft()
    await waitFor(() => expect(intentCalls().length).toBeGreaterThan(0), { timeout: 3000 })
    expect(screen.queryByLabelText(LABEL)).toBeNull()
    expect(intentCalls()[0].liveOptIn).toBe(false)
  })

  it('sends false when the customer leaves it alone', async () => {
    openDraft()
    await waitFor(() => expect(intentCalls().length).toBeGreaterThan(0), { timeout: 3000 })
    expect(intentCalls()[0].liveOptIn).toBe(false)
  })

  it('saves a tick, then an untick, onto the order', async () => {
    openDraft()
    await waitFor(() => expect(intentCalls().length).toBe(1), { timeout: 3000 })

    fireEvent.click(await screen.findByLabelText(LABEL))
    await waitFor(() => expect(intentCalls().length).toBe(2))
    expect(intentCalls()[1]).toMatchObject({ liveOptIn: true, existingOrderId: ORDER, existingPaymentIntentId: 'pi_test' })

    fireEvent.click(screen.getByLabelText(LABEL))
    await waitFor(() => expect(intentCalls().length).toBe(3))
    expect(intentCalls()[2].liveOptIn).toBe(false)
  })

  it('does not lose a tick that lands while a call is in flight', async () => {
    let finishFirst: (v: unknown) => void = () => {}
    let held = true
    apiFetch.mockImplementation((path: string) => {
      if (path !== INTENT) return Promise.resolve(draft())
      if (held) {
        held = false
        return new Promise(resolve => {
          finishFirst = resolve
        })
      }
      return Promise.resolve({ clientSecret: 'pi_test_secret', paymentIntentId: 'pi_test', orderId: ORDER })
    })
    render(
      <MemoryRouter initialEntries={[`/checkout?order=${ORDER}`]}>
        <Checkout />
      </MemoryRouter>,
    )
    await waitFor(() => expect(intentCalls().length).toBe(1), { timeout: 3000 })
    expect(intentCalls()[0].liveOptIn).toBe(false)

    fireEvent.click(await screen.findByLabelText(LABEL))
    expect(intentCalls().length).toBe(1) // the guard holds it back for now

    finishFirst({ clientSecret: 'pi_test_secret', paymentIntentId: 'pi_test', orderId: ORDER })
    await waitFor(() => expect(intentCalls().length).toBe(2))
    expect(intentCalls()[1].liveOptIn).toBe(true)
  })

  it('remembers the answer when the customer comes back to pay a draft', async () => {
    openDraft({ live_opt_in: true })
    await waitFor(() => expect(((screen.queryByLabelText(LABEL) as HTMLInputElement) ?? {}).checked).toBe(true), { timeout: 3000 })
    await waitFor(() => expect(intentCalls().length).toBeGreaterThan(0), { timeout: 3000 })
    expect(intentCalls().at(-1).liveOptIn).toBe(true)
  })
})
