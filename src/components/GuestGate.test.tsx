// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { GuestGateProvider, useGuestGate } from './GuestGate'
import { GUEST_GATE_COPY } from '../lib/guest-gate'

const mockAuth = vi.fn()
vi.mock('../context/SupabaseAuthContext', () => ({
  useAuth: () => mockAuth(),
}))

const spent = vi.fn()

function Tool() {
  const { requireAccount } = useGuestGate()
  return (
    <button
      onClick={() => {
        if (requireAccount('toy-mix')) spent()
      }}
    >
      Mix
    </button>
  )
}

function SignupProbe() {
  const location = useLocation()
  const state = location.state as { reason?: string; from?: { pathname?: string } } | null
  return (
    <div>
      SIGNUP {state?.reason} from {state?.from?.pathname}
    </div>
  )
}

function renderTool() {
  return render(
    <MemoryRouter initialEntries={['/toy-creator']}>
      <GuestGateProvider>
        <Routes>
          <Route path="/toy-creator" element={<Tool />} />
          <Route path="/signup" element={<SignupProbe />} />
          <Route path="/login" element={<div>LOGIN PAGE</div>} />
        </Routes>
      </GuestGateProvider>
    </MemoryRouter>,
  )
}

describe('GuestGate', () => {
  beforeEach(() => {
    mockAuth.mockReset()
    spent.mockReset()
    localStorage.clear()
  })
  afterEach(cleanup)

  it('lets a signed-in visitor straight through', () => {
    mockAuth.mockReturnValue({ user: { id: 'u1' }, loading: false })
    renderTool()
    fireEvent.click(screen.getByText('Mix'))
    expect(spent).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('stops a guest at the spending step and says why', () => {
    mockAuth.mockReturnValue({ user: null, loading: false })
    renderTool()
    fireEvent.click(screen.getByText('Mix'))
    expect(spent).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText(GUEST_GATE_COPY['toy-mix'].title)).toBeTruthy()
    expect(screen.getByText(GUEST_GATE_COPY['toy-mix'].why)).toBeTruthy()
  })

  it('sends a guest to sign-up and remembers where they were', () => {
    mockAuth.mockReturnValue({ user: null, loading: false })
    renderTool()
    fireEvent.click(screen.getByText('Mix'))
    fireEvent.click(screen.getByText('Create free account'))
    expect(screen.getByText(/SIGNUP toy-mix from \/toy-creator/)).toBeTruthy()
    expect(localStorage.getItem('auth_return_to')).toBe('/toy-creator')
  })

  it('offers sign-in for an existing account', () => {
    mockAuth.mockReturnValue({ user: null, loading: false })
    renderTool()
    fireEvent.click(screen.getByText('Mix'))
    fireEvent.click(screen.getByText('I already have an account'))
    expect(screen.getByText('LOGIN PAGE')).toBeTruthy()
  })

  it('lets the guest keep looking around', () => {
    mockAuth.mockReturnValue({ user: null, loading: false })
    renderTool()
    fireEvent.click(screen.getByText('Mix'))
    fireEvent.click(screen.getByText('Keep looking around'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('Mix')).toBeTruthy()
  })
})
