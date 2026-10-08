import React, { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, ShoppingCart, MessageCircle, Sparkles, Package, Image as ImageIcon,
  FlaskConical, Shirt, Layers, Tag, Ticket, Mail, Users, ScrollText, Gift, Banknote,
  FileText, Boxes, Send, Palette, CheckCircle2, ArrowLeft,
  type LucideIcon,
} from 'lucide-react'
import { useSidebar } from '../../context/SidebarContext'

// The one admin nav. Every admin page is wrapped in <AdminShell> at the route, so
// the shop's tools live in one grouped list instead of 20 flat tabs plus a pile of
// side doors. Tab items open AdminDashboard (`/admin?tab=…`); the rest are pages.
// On desktop it is the ONLY menu: the shop sidebar steps aside while it is open
// (David 2026-10-08, "we still have 2 nav bars"), and Back to Shop takes you out.
export interface AdminNavItem {
  label: string
  to: string
  icon: LucideIcon
  hint?: string
  /** Indented shortcut under its parent (Orders → Delivered). */
  sub?: boolean
}
export interface AdminNavGroup { title: string; items: AdminNavItem[] }

export const ADMIN_NAV: AdminNavGroup[] = [
  {
    title: 'Run the shop',
    items: [
      { label: 'Overview', to: '/admin', icon: LayoutDashboard },
      { label: 'Orders', to: '/admin/orders', icon: ShoppingCart },
      { label: 'Delivered', to: '/admin/orders?tab=delivered', icon: CheckCircle2, sub: true },
      { label: 'Support', to: '/admin?tab=support', icon: MessageCircle },
      { label: 'Live chat', to: '/admin?tab=support', icon: MessageCircle, sub: true, hint: 'Routes to Christina through Becky' },
    ],
  },
  {
    title: 'Make',
    items: [
      { label: 'Step Flow builder', to: '/imagination-station', icon: Sparkles, hint: 'The one way to make a product' },
      { label: 'Products', to: '/admin?tab=products', icon: Package },
      { label: 'Creator Products', to: '/admin?tab=creator-products', icon: Palette },
      { label: 'Designs', to: '/admin?tab=designs', icon: ImageIcon },
      { label: 'Toy Lab', to: '/admin/toys', icon: FlaskConical },
      { label: 'Team Templates', to: '/admin/team-templates', icon: Shirt },
      { label: 'Materials', to: '/admin?tab=materials', icon: Layers },
      { label: 'Inventory', to: '/admin?tab=inventory', icon: Boxes },
      { label: 'Social Outbox', to: '/admin?tab=outbox', icon: Send },
    ],
  },
  {
    title: 'Money',
    items: [
      { label: 'Pricing', to: '/admin?tab=pricing', icon: Tag },
      { label: 'Coupons', to: '/admin?tab=coupons', icon: Ticket },
      { label: 'Gift Cards', to: '/admin?tab=gift-cards', icon: Gift },
      { label: 'Cash Out', to: '/admin?tab=connect', icon: Banknote },
      { label: 'Invoices', to: '/admin?tab=invoices', icon: FileText },
      { label: 'Email', to: '/admin/email', icon: Mail },
    ],
  },
  {
    title: 'People',
    items: [
      { label: 'Users', to: '/admin?tab=users', icon: Users, hint: 'Accounts, roles and wallets' },
      { label: 'Audit', to: '/admin?tab=audit', icon: ScrollText },
    ],
  },
]

// Pages that used to be their own tab and now live inside another. Old
// bookmarks and the notification bell still carry the old ?tab= value.
export const LEGACY_TABS: Record<string, string> = {
  'itc-pricing': 'pricing',
  imagination: 'pricing',
  wallet: 'users',
}

function splitTo(to: string) {
  const [path, query = ''] = to.split('?')
  return { path, tab: new URLSearchParams(query).get('tab') }
}

export function isNavActive(item: AdminNavItem, pathname: string, search: string): boolean {
  const { path, tab } = splitTo(item.to)
  const cur = new URLSearchParams(search).get('tab')
  const dash = pathname === '/admin' || pathname === '/admin/dashboard'
  if (path === '/admin') {
    if (!dash) return false
    const curTab = cur ? (LEGACY_TABS[cur] || cur) : null
    if (item.label === 'Live chat') return false // shortcut only, Support carries the highlight
    return (tab || null) === (curTab && curTab !== 'overview' ? curTab : null)
  }
  if (path === '/admin/orders') {
    if (pathname !== '/admin/orders' && pathname !== '/orders') return false
    return item.sub ? cur === tab : cur !== 'delivered'
  }
  return pathname === path || pathname.startsWith(path + '/')
}

const AdminShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { pathname, search } = useLocation()
  const flat = ADMIN_NAV.flatMap(g => g.items.filter(i => !i.sub))
  const { setSiteMenuHidden } = useSidebar()

  useEffect(() => {
    setSiteMenuHidden(true)
    return () => setSiteMenuHidden(false)
  }, [setSiteMenuHidden])

  return (
    <div className="lg:flex lg:items-start">
      <aside
        aria-label="Admin sections"
        className="hidden lg:block w-56 shrink-0 sticky top-0 self-start max-h-screen overflow-y-auto border-r border-border bg-card px-3 py-5"
      >
        <Link
          to="/"
          className="mb-4 flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-sm font-semibold text-text hover:border-primary hover:text-primary transition-colors"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <img src="/mr-imagine/mr-imagine-head.png" alt="" className="h-5 w-auto" />
          Back to Shop
        </Link>
        <div className="px-2 pb-4">
          <div className="text-sm font-display font-bold text-text">ITP Admin</div>
          <div className="text-xs text-muted">Everything that runs the shop</div>
        </div>
        {ADMIN_NAV.map(group => (
          <nav key={group.title} className="mb-3">
            <div className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">{group.title}</div>
            <ul className="space-y-0.5">
              {group.items.map(item => {
                const active = isNavActive(item, pathname, search)
                const Icon = item.icon
                return (
                  <li key={item.label}>
                    <Link
                      to={item.to}
                      title={item.hint}
                      aria-current={active ? 'page' : undefined}
                      className={`flex items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors ${item.sub ? 'ml-6 py-1 text-xs' : 'py-1.5 font-medium'} ${
                        active
                          ? 'bg-primary text-white shadow-md shadow-purple-500/20'
                          : 'text-muted hover:bg-primary/10 hover:text-text'
                      }`}
                    >
                      {!item.sub && <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />}
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </nav>
        ))}
      </aside>

      <div className="lg:hidden sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur">
        <nav aria-label="Admin sections" className="flex gap-1.5 overflow-x-auto px-3 py-2">
          {flat.map(item => {
            const active = isNavActive(item, pathname, search)
            return (
              <Link
                key={item.label}
                to={item.to}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium ${active ? 'bg-primary text-white' : 'bg-bg text-muted'}`}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>
      </div>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

export default AdminShell
