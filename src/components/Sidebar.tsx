import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/SupabaseAuthContext'
import { useCart } from '../context/CartContext'
import { useSidebar } from '../context/SidebarContext'
import {
  ShoppingBag,
  Users,
  Wallet,
  ShoppingCart,
  User,
  LayoutDashboard,
  Settings,
  ClipboardList,
  UsersRound,
  Megaphone,
  Package,
  DollarSign,
  Monitor,
  BarChart3,
  Share2,
  Sparkles,
  TrendingUp,
  FileText,
  LogOut,
  MessageSquare,
  CreditCard,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
  Contact,
  Mail
} from 'lucide-react'

interface NavItemProps {
  to: string
  icon: React.ReactNode
  label: string
  isCollapsed: boolean
  isActive: boolean
  highlight?: boolean
  badge?: number | string
  onClick?: () => void
}

function NavItem({ to, icon, label, isCollapsed, isActive, highlight, badge, onClick }: NavItemProps) {
  const baseClasses = 'flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 relative group'
  const activeClasses = highlight
    ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg shadow-purple-500/30'
    : isActive
      ? 'bg-purple-100 text-purple-700'
      : 'text-gray-600 hover:bg-purple-50 hover:text-purple-600'

  return (
    <Link
      to={to}
      className={`${baseClasses} ${activeClasses} ${isCollapsed ? 'justify-center' : ''}`}
      onClick={onClick}
      title={isCollapsed ? label : undefined}
    >
      <span className="flex-shrink-0">{icon}</span>
      {!isCollapsed && <span className="text-sm font-medium truncate">{label}</span>}
      {badge !== undefined && (
        <span className={`absolute ${isCollapsed ? '-top-1 -right-1' : 'right-3'} min-w-5 h-5 flex items-center justify-center text-xs font-bold rounded-full ${highlight ? 'bg-white text-purple-600' : 'bg-pink-500 text-white'
          }`}>
          {typeof badge === 'number' && badge > 99 ? '99+' : badge}
        </span>
      )}
      {isCollapsed && (
        <div className="absolute left-full ml-2 px-3 py-1.5 bg-gray-900 text-white text-sm rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all whitespace-nowrap z-50 shadow-lg">
          {label}
        </div>
      )}
    </Link>
  )
}

interface SectionProps {
  title: string
  isCollapsed: boolean
  children: React.ReactNode
}

function Section({ title, isCollapsed, children }: SectionProps) {
  return (
    <div className="py-2">
      {!isCollapsed && (
        <div className="px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
          {title}
        </div>
      )}
      {isCollapsed && <div className="border-t border-purple-100 mx-3 my-2" />}
      <div className="space-y-1">{children}</div>
    </div>
  )
}

export function Sidebar() {
  const { user, signOut } = useAuth()
  const { state: cartState } = useCart()
  const { isCollapsed, isMobileOpen, toggleSidebar, closeMobile } = useSidebar()
  const location = useLocation()

  const cartCount = cartState ? cartState.items.reduce((sum: number, item: any) => sum + item.quantity, 0) : 0
  const itcBalance = user?.wallet?.itcBalance || 0

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + '/')

  // Sidebar content (shared between desktop and mobile)
  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Logo and Toggle */}
      <div className={`flex items-center h-20 px-4 border-b border-purple-100 ${isCollapsed ? 'justify-center' : 'justify-between'}`}>
        <Link to="/" className="flex items-center" onClick={closeMobile}>
          {isCollapsed ? (
            <img src="/itp-logo-v3.png" alt="ITP" className="h-8 w-auto" />
          ) : (
            <img src="/itp-logo-v3.png" alt="Imagine This Printed" className="h-10 w-auto" />
          )}
        </Link>
        <button
          onClick={toggleSidebar}
          className="hidden lg:flex p-2 rounded-lg hover:bg-purple-50 text-gray-500 hover:text-purple-600 transition-colors"
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isCollapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-3">
        {/* Main Navigation */}
        <Section title="Shop" isCollapsed={isCollapsed}>
          <NavItem
            to="/catalog"
            icon={<ShoppingBag className="w-5 h-5" />}
            label="Products"
            isCollapsed={isCollapsed}
            isActive={isActive('/catalog')}
            onClick={closeMobile}
          />
          <NavItem
            to="/imagination-station"
            icon={<Sparkles className="w-5 h-5" />}
            label="Imagination Station"
            isCollapsed={isCollapsed}
            isActive={isActive('/imagination-station')}
            highlight={true}
            onClick={closeMobile}
          />
          <NavItem
            to="/community"
            icon={<Users className="w-5 h-5" />}
            label="Community"
            isCollapsed={isCollapsed}
            isActive={isActive('/community')}
            onClick={closeMobile}
          />
          <NavItem
            to="/contact"
            icon={<Contact className="w-5 h-5" />}
            label="Contact"
            isCollapsed={isCollapsed}
            isActive={isActive('/contact')}
            onClick={closeMobile}
          />
        </Section>

        {/* User Section (when logged in) */}
        {user && (
          <Section title="Account" isCollapsed={isCollapsed}>
            <NavItem
              to="/wallet"
              icon={<Wallet className="w-5 h-5" />}
              label={`Wallet${!isCollapsed && itcBalance > 0 ? ` ($${itcBalance})` : ''}`}
              isCollapsed={isCollapsed}
              isActive={isActive('/wallet')}
              badge={isCollapsed && itcBalance > 0 ? itcBalance : undefined}
              onClick={closeMobile}
            />
            <NavItem
              to="/cart"
              icon={<ShoppingCart className="w-5 h-5" />}
              label="Cart"
              isCollapsed={isCollapsed}
              isActive={isActive('/cart')}
              badge={cartCount > 0 ? cartCount : undefined}
              onClick={closeMobile}
            />
            <NavItem
              to="/account/orders"
              icon={<FileText className="w-5 h-5" />}
              label="My Orders"
              isCollapsed={isCollapsed}
              isActive={isActive('/account/orders')}
              onClick={closeMobile}
            />
            <NavItem
              to="/account/designs"
              icon={<Package className="w-5 h-5" />}
              label="My Designs"
              isCollapsed={isCollapsed}
              isActive={isActive('/account/designs') || isActive('/my-designs')}
              onClick={closeMobile}
            />
          </Section>
        )}

        {/* Cart for non-logged in users */}
        {!user && (
          <Section title="Shopping" isCollapsed={isCollapsed}>
            <NavItem
              to="/cart"
              icon={<ShoppingCart className="w-5 h-5" />}
              label="Cart"
              isCollapsed={isCollapsed}
              isActive={isActive('/cart')}
              badge={cartCount > 0 ? cartCount : undefined}
              onClick={closeMobile}
            />
          </Section>
        )}

        {/* Founder Section */}
        {user?.role === 'founder' && (
          <Section title="Founder" isCollapsed={isCollapsed}>
            <NavItem
              to="/founder/dashboard"
              icon={<LayoutDashboard className="w-5 h-5" />}
              label="Dashboard"
              isCollapsed={isCollapsed}
              isActive={isActive('/founder/dashboard')}
              onClick={closeMobile}
            />
            <NavItem
              to="/founder/earnings"
              icon={<TrendingUp className="w-5 h-5" />}
              label="Earnings"
              isCollapsed={isCollapsed}
              isActive={isActive('/founder/earnings')}
              onClick={closeMobile}
            />
          </Section>
        )}

        {/* Vendor Section */}
        {user?.role === 'vendor' && (
          <Section title="Vendor" isCollapsed={isCollapsed}>
            <NavItem
              to="/vendor/dashboard"
              icon={<LayoutDashboard className="w-5 h-5" />}
              label="Dashboard"
              isCollapsed={isCollapsed}
              isActive={isActive('/vendor/dashboard')}
              onClick={closeMobile}
            />
            <NavItem
              to="/vendor/messages"
              icon={<MessageSquare className="w-5 h-5" />}
              label="Customer Messages"
              isCollapsed={isCollapsed}
              isActive={isActive('/vendor/messages')}
              onClick={closeMobile}
            />
            <NavItem
              to="/vendor/payouts"
              icon={<CreditCard className="w-5 h-5" />}
              label="Payouts"
              isCollapsed={isCollapsed}
              isActive={isActive('/vendor/payouts')}
              onClick={closeMobile}
            />
            <NavItem
              to="/admin/kiosk-analytics"
              icon={<BarChart3 className="w-5 h-5" />}
              label="Kiosk Analytics"
              isCollapsed={isCollapsed}
              isActive={isActive('/admin/kiosk-analytics')}
              onClick={closeMobile}
            />
          </Section>
        )}

        {/* Admin Section */}
        {(user?.role === 'admin' || user?.role === 'manager') && (
          <Section title="Admin" isCollapsed={isCollapsed}>
            <NavItem
              to="/admin/dashboard"
              icon={<LayoutDashboard className="w-5 h-5" />}
              label="Dashboard"
              isCollapsed={isCollapsed}
              isActive={isActive('/admin/dashboard')}
              onClick={closeMobile}
            />
            <NavItem
              to="/admin/control-panel"
              icon={<Settings className="w-5 h-5" />}
              label="Control Panel"
              isCollapsed={isCollapsed}
              isActive={isActive('/admin/control-panel')}
              onClick={closeMobile}
            />
            <NavItem
              to="/admin/orders"
              icon={<ClipboardList className="w-5 h-5" />}
              label="Order Management"
              isCollapsed={isCollapsed}
              isActive={isActive('/admin/orders')}
              onClick={closeMobile}
            />
            <NavItem
              to="/admin/crm"
              icon={<UsersRound className="w-5 h-5" />}
              label="CRM & Customers"
              isCollapsed={isCollapsed}
              isActive={isActive('/admin/crm')}
              onClick={closeMobile}
            />
            <NavItem
              to="/admin/marketing"
              icon={<Megaphone className="w-5 h-5" />}
              label="Marketing Tools"
              isCollapsed={isCollapsed}
              isActive={isActive('/admin/marketing')}
              onClick={closeMobile}
            />
            <NavItem
              to="/admin/email-templates"
              icon={<Mail className="w-5 h-5" />}
              label="Email Templates"
              isCollapsed={isCollapsed}
              isActive={isActive('/admin/email-templates')}
              onClick={closeMobile}
            />
            {user?.role === 'admin' && (
              <>
                <NavItem
                  to="/admin/cost-override"
                  icon={<DollarSign className="w-5 h-5" />}
                  label="Cost Override"
                  isCollapsed={isCollapsed}
                  isActive={isActive('/admin/cost-override')}
                  onClick={closeMobile}
                />
                <NavItem
                  to="/admin/kiosks"
                  icon={<Monitor className="w-5 h-5" />}
                  label="Kiosk Management"
                  isCollapsed={isCollapsed}
                  isActive={isActive('/admin/kiosks')}
                  onClick={closeMobile}
                />
                <NavItem
                  to="/admin/kiosk-analytics"
                  icon={<BarChart3 className="w-5 h-5" />}
                  label="Kiosk Analytics"
                  isCollapsed={isCollapsed}
                  isActive={isActive('/admin/kiosk-analytics')}
                  onClick={closeMobile}
                />
                <NavItem
                  to="/admin/social-content"
                  icon={<Share2 className="w-5 h-5" />}
                  label="Social Content"
                  isCollapsed={isCollapsed}
                  isActive={isActive('/admin/social-content')}
                  onClick={closeMobile}
                />
                <NavItem
                  to="/admin/ai/products/create"
                  icon={<Sparkles className="w-5 h-5" />}
                  label="AI Product Builder"
                  isCollapsed={isCollapsed}
                  isActive={isActive('/admin/ai/products/create')}
                  onClick={closeMobile}
                />
              </>
            )}
          </Section>
        )}

        {/* Manager Section */}
        {(user?.role === 'manager' || user?.role === 'admin' || user?.role === 'founder') && (
          <Section title="Manager" isCollapsed={isCollapsed}>
            <NavItem
              to="/manager/dashboard"
              icon={<DollarSign className="w-5 h-5" />}
              label="Cost Controls"
              isCollapsed={isCollapsed}
              isActive={isActive('/manager/dashboard')}
              onClick={closeMobile}
            />
          </Section>
        )}

        {/* Wholesale Section */}
        {user?.role === 'wholesale' && (
          <Section title="Business" isCollapsed={isCollapsed}>
            <NavItem
              to="/wholesale"
              icon={<Package className="w-5 h-5" />}
              label="Wholesale Portal"
              isCollapsed={isCollapsed}
              isActive={isActive('/wholesale')}
              onClick={closeMobile}
            />
          </Section>
        )}
      </nav>

      {/* User Profile / Sign In */}
      <div className="border-t border-purple-100 p-3">
        {user ? (
          <div className={`flex ${isCollapsed ? 'flex-col items-center gap-2' : 'items-center gap-3'}`}>
            <Link
              to="/account/profile"
              className="flex-shrink-0"
              onClick={closeMobile}
            >
              {user.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt={user.username || 'Profile'}
                  className="w-10 h-10 rounded-full object-cover border-2 border-purple-300 shadow-lg hover:shadow-purple-300/50 transition-shadow"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-semibold text-sm shadow-lg hover:shadow-purple-300/50 transition-shadow">
                  {user.username?.charAt(0).toUpperCase() || 'U'}
                </div>
              )}
            </Link>
            {!isCollapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{user.username}</p>
                <p className="text-xs text-gray-500 truncate">{user.email}</p>
              </div>
            )}
            <button
              onClick={() => {
                signOut()
                closeMobile()
              }}
              className={`p-2 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors ${isCollapsed ? '' : 'ml-auto'}`}
              title="Sign Out"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        ) : (
          <Link
            to="/login"
            className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-purple-500 to-purple-600 text-white text-sm font-semibold hover:from-purple-600 hover:to-purple-700 transition-all shadow-lg shadow-purple-200 ${isCollapsed ? 'w-10 h-10 p-0' : 'w-full'}`}
            onClick={closeMobile}
          >
            {isCollapsed ? <User className="w-5 h-5" /> : 'Sign In'}
          </Link>
        )}
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        className={`hidden lg:flex flex-col fixed left-0 top-0 h-screen bg-white border-r border-purple-100 shadow-sm z-40 transition-all duration-300 ${isCollapsed ? 'w-16' : 'w-60'
          }`}
      >
        {sidebarContent}
      </aside>

      {/* Mobile Overlay */}
      {isMobileOpen && (
        <>
          <div
            className="lg:hidden fixed inset-0 bg-black/50 z-40 animate-fade-in"
            onClick={closeMobile}
          />
          <aside className="lg:hidden fixed inset-y-0 left-0 w-64 bg-white z-50 shadow-xl animate-sidebar-slide-in">
            <button
              onClick={closeMobile}
              className="absolute top-4 right-4 p-2 rounded-lg hover:bg-purple-50 text-gray-500 hover:text-purple-600 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            {sidebarContent}
          </aside>
        </>
      )}
    </>
  )
}

// Mobile menu button component for use in layouts
export function MobileMenuButton() {
  const { toggleMobile } = useSidebar()

  return (
    <button
      onClick={toggleMobile}
      className="lg:hidden fixed top-4 left-4 z-50 p-2.5 rounded-xl bg-white shadow-lg border border-purple-100 text-purple-600 hover:bg-purple-50 transition-colors"
      aria-label="Toggle menu"
    >
      <Menu className="w-5 h-5" />
    </button>
  )
}
