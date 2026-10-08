// @vitest-environment jsdom
// David 2026-10-07 (screenshot): the admin pages drew TWO menus side by side, the site sidebar's 13-item
// Admin list (Control Panel, CRM, Kiosks, Cost Override...) next to AdminShell's grouped menu. The sidebar
// now has one door into admin; AdminShell owns everything inside it.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

afterEach(cleanup)

let role = 'admin'
vi.mock('../context/SupabaseAuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'a@b.c', role, username: 'admin' }, signOut: vi.fn() }),
}))
vi.mock('../context/CartContext', () => ({ useCart: () => ({ state: { items: [] } }) }))
vi.mock('../context/SidebarContext', () => ({
  useSidebar: () => ({ isCollapsed: false, isMobileOpen: false, toggleSidebar: vi.fn(), closeMobile: vi.fn() }),
}))

import { Sidebar } from './Sidebar'

const draw = (path = '/admin') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar />
    </MemoryRouter>,
  )

describe('Sidebar admin section', () => {
  it('gives an admin one Shop Admin door, not a second admin menu', () => {
    role = 'admin'
    draw()
    expect(screen.getAllByText('Shop Admin').length).toBeGreaterThan(0)
    for (const old of ['Control Panel', 'CRM & Customers', 'Marketing Tools', 'Cost Override', 'Kiosk Management', 'Kiosk Analytics', 'Email Templates', 'Cost Controls']) {
      expect(screen.queryByText(old)).toBeNull()
    }
  })

  it('shows no admin door to a customer', () => {
    role = 'customer'
    draw('/')
    expect(screen.queryByText('Shop Admin')).toBeNull()
  })
})
