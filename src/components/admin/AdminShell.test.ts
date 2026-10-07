import { describe, it, expect } from 'vitest'
import { ADMIN_NAV, LEGACY_TABS, isNavActive } from './AdminShell'

const items = ADMIN_NAV.flatMap(g => g.items)
const active = (pathname: string, search = '') =>
  items.filter(i => isNavActive(i, pathname, search)).map(i => i.label)

describe('admin nav', () => {
  it('highlights Overview on the bare dashboard', () => {
    expect(active('/admin')).toEqual(['Overview'])
    expect(active('/admin', '?tab=overview')).toEqual(['Overview'])
  })

  it('highlights exactly one item per dashboard tab', () => {
    expect(active('/admin', '?tab=users')).toEqual(['Users'])
    expect(active('/admin', '?tab=support')).toEqual(['Support'])
  })

  it('sends the retired tabs to the tab that absorbed them', () => {
    expect(LEGACY_TABS['itc-pricing']).toBe('pricing')
    expect(LEGACY_TABS.imagination).toBe('pricing')
    expect(LEGACY_TABS.wallet).toBe('users')
    expect(active('/admin', '?tab=wallet')).toEqual(['Users'])
    expect(active('/admin', '?tab=itc-pricing')).toEqual(['Pricing'])
  })

  it('splits Orders from its Delivered shortcut', () => {
    expect(active('/admin/orders')).toEqual(['Orders'])
    expect(active('/admin/orders', '?tab=delivered')).toEqual(['Delivered'])
  })

  it('marks the standalone admin pages', () => {
    expect(active('/admin/toys')).toEqual(['Toy Lab'])
    expect(active('/admin/team-templates/abc')).toEqual(['Team Templates'])
    expect(active('/admin/email')).toEqual(['Email'])
  })

  it('no longer lists the retired tabs', () => {
    const labels = items.map(i => i.label.toLowerCase())
    for (const dead of ['vendors', 'models', 'virtual try-on', 'wallet']) expect(labels).not.toContain(dead)
  })
})
