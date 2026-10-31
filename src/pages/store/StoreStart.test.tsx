// @vitest-environment jsdom
// Her sign-up flow (/start/crystal): five steps that pick up where she left off. The API and Supabase are faked; the
// fleet browser walk covers the real page.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const h = vi.hoisted(() => ({
  user: null as null | { email: string },
  signUp: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  load: vi.fn(),
  saveStore: vi.fn(),
  payoutsLink: vi.fn(),
}))

vi.mock('../../context/SupabaseAuthContext', () => ({
  useAuth: () => ({ user: h.user, loading: false, signUp: h.signUp, signIn: h.signIn, signOut: h.signOut }),
}))
vi.mock('../../components/TurnstileWidget', () => ({ default: () => null }))
vi.mock('../../lib/captcha', () => ({ isCaptchaConfigured: () => false, friendlySignupError: (m: string) => m }))
vi.mock('../../lib/vendor-store', () => ({
  // The real module pulls in Supabase; these two are its tiny pure helpers, copied.
  emptyAddress: () => ({ name: '', street1: '', street2: '', city: '', state: '', zip: '', phone: '' }),
  addressReady: (a: any) => !!(a.name.trim() && a.street1.trim() && a.city.trim() && /^[A-Za-z]{2}$/.test(a.state.trim()) && /^\d{5}(-\d{4})?$/.test(a.zip.trim())),
  fetchStore: vi.fn().mockResolvedValue({
    store: { slug: 'crystal', name: 'Crystal’s Shirts and More', tagline: null, logoUrl: null, open: false, instagram: null, theme: { ownerFirst: 'Crystal', character: '/stores/crystal/character.webp' } },
    items: [],
  }),
  vendorStoreApi: { load: (...a: unknown[]) => h.load(...a), saveStore: (...a: unknown[]) => h.saveStore(...a), payoutsLink: (...a: unknown[]) => h.payoutsLink(...a) },
}))

import StoreStart from './StoreStart'

const mine = (over: Record<string, unknown> = {}, payouts = { hasAccount: false, ready: false, detailsSubmitted: false }) => ({
  isAdmin: false,
  store: { slug: 'crystal', name: 'Crystal’s Shirts and More', status: 'draft', shipFrom: null, theme: {}, ...over },
  payouts,
  items: [],
  orders: [],
})

const page = (url = '/start/crystal') =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes><Route path="/start/:slug" element={<StoreStart />} /></Routes>
    </MemoryRouter>
  )

afterEach(cleanup)
beforeEach(() => {
  h.user = null
  Object.values(h).forEach(v => typeof v === 'function' && 'mockReset' in v && (v as any).mockReset())
})

describe('StoreStart', () => {
  it('opens on the welcome step with Rico’s line and goes on to create her account', async () => {
    page()
    expect(await screen.findByText(/Let’s open your store, Crystal/)).toBeTruthy()
    expect(screen.getByText(/let us get your store open/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Let’s go/ }))
    expect(await screen.findByRole('heading', { name: 'Create your account' })).toBeTruthy()
  })

  it('creates the account, then tells her to check her email and come right back', async () => {
    h.signUp.mockResolvedValue({})
    page('/start/crystal?step=2')
    fireEvent.change(await screen.findByLabelText('First name'), { target: { value: 'Crystal' } })
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'T' } })
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'ctrin82@yahoo.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret12' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(h.signUp).toHaveBeenCalledWith('ctrin82@yahoo.com', 'secret12', { firstName: 'Crystal', lastName: 'T' }, null))
    expect(await screen.findByText('Check your email')).toBeTruthy()
    expect(localStorage.getItem('auth_return_to')).toBe('/start/crystal?step=2')
  })

  it('picks up at the ship-from step when she is signed in with no address, and saves it', async () => {
    h.user = { email: 'ctrin82@yahoo.com' }
    h.load.mockResolvedValueOnce(mine()).mockResolvedValue(mine({ shipFrom: { name: 'Crystal T', street1: '1 Main St', street2: '', city: 'Rockmart', state: 'GA', zip: '30153', phone: '555' } }))
    h.saveStore.mockResolvedValue({})
    page('/start/crystal?step=2')
    expect(await screen.findByRole('heading', { name: 'Where do you ship from?' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Crystal T' } })
    fireEvent.change(screen.getByLabelText('Street address'), { target: { value: '1 Main St' } })
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Rockmart' } })
    fireEvent.change(screen.getByLabelText('State'), { target: { value: 'GA' } })
    fireEvent.change(screen.getByLabelText('ZIP code'), { target: { value: '30153' } })
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '555' } })
    fireEvent.click(screen.getByRole('button', { name: /Save and continue/ }))
    await waitFor(() => expect(h.saveStore).toHaveBeenCalledWith('crystal', expect.objectContaining({ shipFrom: expect.objectContaining({ zip: '30153' }) })))
    expect(await screen.findByRole('heading', { name: 'Get paid' })).toBeTruthy()
  })

  it('sends her to Stripe and back to this flow from the payouts step', async () => {
    h.user = { email: 'ctrin82@yahoo.com' }
    h.load.mockResolvedValue(mine({ shipFrom: { name: 'C', street1: '1', street2: '', city: 'R', state: 'GA', zip: '30153', phone: '5' } }))
    h.payoutsLink.mockResolvedValue({ url: 'about:blank#stripe' })
    page('/start/crystal?step=2')
    fireEvent.click(await screen.findByRole('button', { name: /Set up payouts/ }))
    await waitFor(() => expect(h.payoutsLink).toHaveBeenCalledWith('crystal', 'start'))
  })

  it('tells her when she is signed in with an email that is not this store’s', async () => {
    h.user = { email: 'someone@else.com' }
    h.load.mockRejectedValue(new Error('HTTP 403: {"error":"Not your store"}'))
    page('/start/crystal?step=2')
    expect(await screen.findByText(/isn’t this store’s/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Sign out and try again/ }))
    expect(h.signOut).toHaveBeenCalled()
  })

  it('finishes on the all-set step when payouts and her address are done', async () => {
    h.user = { email: 'ctrin82@yahoo.com' }
    h.load.mockResolvedValue(mine({ shipFrom: { name: 'C', street1: '1', street2: '', city: 'R', state: 'GA', zip: '30153', phone: '5' } }, { hasAccount: true, ready: true, detailsSubmitted: true }))
    page('/start/crystal?step=2')
    expect(await screen.findByRole('heading', { name: /You’re all set, Crystal/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Open my store manager/ }).getAttribute('href')).toBe('/vendor/store/crystal')
  })
})
