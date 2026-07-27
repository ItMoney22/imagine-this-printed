// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import RoleRoute from './RoleRoute'

// RoleRoute reads auth state from SupabaseAuthContext. Stub the hook so these
// tests exercise the guard logic alone, with no Supabase network calls.
const mockAuth = vi.fn()
vi.mock('../context/SupabaseAuthContext', () => ({
  useAuth: () => mockAuth()
}))

function renderAt(path = '/admin') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/admin"
          element={
            <RoleRoute allowedRoles={['admin', 'manager']}>
              <div>ADMIN CONTENT</div>
            </RoleRoute>
          }
        />
        <Route path="/login" element={<div>LOGIN PAGE</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('RoleRoute', () => {
  beforeEach(() => {
    mockAuth.mockReset()
    localStorage.clear()
  })

  // This project runs vitest without `globals`, so testing-library's automatic
  // per-test cleanup never registers. Unmount by hand or renders stack up in
  // the shared document and later queries match earlier tests' output.
  afterEach(cleanup)

  it('shows a loading state while auth resolves, never the children', () => {
    mockAuth.mockReturnValue({ user: null, loading: true })
    renderAt()
    expect(screen.queryByText('ADMIN CONTENT')).toBeNull()
    expect(screen.getByText('Loading...')).toBeTruthy()
  })

  it('redirects anonymous visitors to /login', () => {
    mockAuth.mockReturnValue({ user: null, loading: false })
    renderAt()
    expect(screen.getByText('LOGIN PAGE')).toBeTruthy()
    expect(screen.queryByText('ADMIN CONTENT')).toBeNull()
  })

  it('remembers where an anonymous visitor was headed', () => {
    mockAuth.mockReturnValue({ user: null, loading: false })
    renderAt()
    expect(localStorage.getItem('auth_return_to')).toBe('/admin')
  })

  it('denies a logged-in user whose role is not allowed', () => {
    mockAuth.mockReturnValue({ user: { id: '1', role: 'customer' }, loading: false })
    renderAt()
    expect(screen.getByText('Access Denied')).toBeTruthy()
    expect(screen.queryByText('ADMIN CONTENT')).toBeNull()
  })

  it('names the current role on the denial screen', () => {
    mockAuth.mockReturnValue({ user: { id: '1', role: 'vendor' }, loading: false })
    renderAt()
    expect(screen.getByText('vendor')).toBeTruthy()
  })

  it('renders children for an allowed role', () => {
    mockAuth.mockReturnValue({ user: { id: '1', role: 'admin' }, loading: false })
    renderAt()
    expect(screen.getByText('ADMIN CONTENT')).toBeTruthy()
  })

  it('accepts every role in allowedRoles, not just the first', () => {
    mockAuth.mockReturnValue({ user: { id: '1', role: 'manager' }, loading: false })
    renderAt()
    expect(screen.getByText('ADMIN CONTENT')).toBeTruthy()
  })

  it('does not treat a missing role as allowed', () => {
    mockAuth.mockReturnValue({ user: { id: '1', role: undefined }, loading: false })
    renderAt()
    expect(screen.queryByText('ADMIN CONTENT')).toBeNull()
    expect(screen.getByText('Access Denied')).toBeTruthy()
  })
})
