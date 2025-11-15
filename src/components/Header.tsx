import { useTheme } from './ThemeProvider'
import { ThemeToggle } from './ThemeToggle'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/SupabaseAuthContext'
import { useCart } from '../context/CartContext'
import { useState, useEffect } from 'react'
import DesignStudioModal from './DesignStudioModal'
import {
  ShoppingBag,
  Palette,
  Users,
  Wallet,
  ShoppingCart,
  User,
  ChevronDown,
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
  CreditCard
} from 'lucide-react'

export function Header() {
  const { theme } = useTheme()
  const { user, signOut } = useAuth()
  const { state: cartState } = useCart()
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showDesignModal, setShowDesignModal] = useState(false)

  // DEBUG: Log user role on component mount and when user changes
  useEffect(() => {
    if (user) {
      console.log('[Header] 👤 User role check:', {
        email: user.email,
        role: user.role,
        roleType: typeof user.role,
        isAdmin: user.role === 'admin',
        fullUser: user
      })
    }
  }, [user])

  // Use light logo in dark mode, dark logo in light mode for contrast
  const logo = theme === 'dark'
    ? import.meta.env.VITE_LOGO_LIGHT
    : import.meta.env.VITE_LOGO_DARK

  // Calculate cart count (with safety check)
  const cartCount = cartState ? cartState.items.reduce((sum: number, item: any) => sum + item.quantity, 0) : 0

  return (
    <header className="sticky top-0 z-40 glass border-b card-border">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link to="/" className="flex items-center space-x-2">
            <img
              src={logo}
              alt="Imagine This Printed"
              className="h-9 w-auto drop-shadow-lg"
            />
          </Link>

          {/* Navigation */}
          <nav className="hidden md:flex items-center gap-8">
            <Link
              to="/catalog"
              className="flex items-center gap-2 text-sm font-medium text-text hover:text-secondary transition-colors relative group"
            >
              <ShoppingBag className="w-4 h-4" />
              Products
              <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-secondary group-hover:w-full transition-all duration-300"></span>
            </Link>
            <button
              onClick={() => setShowDesignModal(true)}
              className="flex items-center gap-2 text-sm font-medium text-text hover:text-secondary transition-colors relative group"
            >
              <Palette className="w-4 h-4" />
              Design Studio
              <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-secondary group-hover:w-full transition-all duration-300"></span>
            </button>
            <Link
              to="/community"
              className="flex items-center gap-2 text-sm font-medium text-text hover:text-secondary transition-colors relative group"
            >
              <Users className="w-4 h-4" />
              Community
              <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-secondary group-hover:w-full transition-all duration-300"></span>
            </Link>
          </nav>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <ThemeToggle />

            {/* Wallet Button */}
            {user && (
              <Link
                to="/wallet"
                className="relative p-3 rounded-xl border card-border bg-card/50 hover:bg-card transition-all"
                aria-label="Wallet"
              >
                <Wallet className="w-5 h-5 text-text" />
                {user.wallet && user.wallet.pointsBalance > 0 && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 bg-accent text-white text-xs font-bold rounded-full flex items-center justify-center">
                    {user.wallet.pointsBalance > 99 ? '99+' : user.wallet.pointsBalance}
                  </span>
                )}
              </Link>
            )}

            {/* Cart Button */}
            <Link
              to="/cart"
              className="relative p-3 rounded-xl border card-border bg-card/50 hover:bg-card transition-all"
              aria-label="Shopping cart"
            >
              <ShoppingCart className="w-5 h-5 text-text" />
              {cartCount > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-accent text-white text-xs font-bold rounded-full flex items-center justify-center">
                  {cartCount}
                </span>
              )}
            </Link>

            {/* User Menu or Sign In */}
            {user ? (
              <div className="relative">
                <button
                  onClick={() => setShowUserMenu(!showUserMenu)}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl border card-border bg-card/50 hover:bg-card transition-all"
                >
                  <div className="w-8 h-8 rounded-full bg-gradient-to-r from-primary to-secondary flex items-center justify-center text-white font-semibold">
                    {user.username?.charAt(0).toUpperCase() || 'U'}
                  </div>
                  <span className="hidden md:block text-sm font-medium text-text">
                    {user.username}
                  </span>
                  <ChevronDown className="w-4 h-4 text-muted" />
                </button>

                {/* Dropdown Menu */}
                {showUserMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setShowUserMenu(false)}
                    ></div>
                    <div className="absolute right-0 mt-2 w-56 glass border card-border rounded-xl shadow-lg py-2 z-20">
                      <Link
                        to="/account/profile"
                        className="flex items-center gap-2 px-4 py-2 text-sm text-text hover:bg-card/50 transition-colors"
                        onClick={() => setShowUserMenu(false)}
                      >
                        <User className="w-4 h-4" />
                        My Profile
                      </Link>
                      <Link
                        to="/wallet"
                        className="flex items-center gap-2 px-4 py-2 text-sm text-text hover:bg-card/50 transition-colors"
                        onClick={() => setShowUserMenu(false)}
                      >
                        <Wallet className="w-4 h-4" />
                        Wallet
                      </Link>
                      <Link
                        to="/orders"
                        className="flex items-center gap-2 px-4 py-2 text-sm text-text hover:bg-card/50 transition-colors"
                        onClick={() => setShowUserMenu(false)}
                      >
                        <FileText className="w-4 h-4" />
                        Orders
                      </Link>

                      {/* Role-specific dashboards */}
                      {user.role === 'founder' && (
                        <>
                          <hr className="my-2 border-card-border" />
                          <div className="px-4 py-2 text-xs font-semibold text-muted uppercase tracking-wider">
                            Founder
                          </div>
                          <Link
                            to="/founder/dashboard"
                            className="flex items-center gap-2 px-4 py-2 text-sm text-text hover:bg-card/50 transition-colors"
                            onClick={() => setShowUserMenu(false)}
                          >
                            <LayoutDashboard className="w-4 h-4" />
                            Dashboard
                          </Link>
                          <Link
                            to="/founder/earnings"
                            className="flex items-center gap-2 px-4 py-2 text-sm text-text hover:bg-card/50 transition-colors"
                            onClick={() => setShowUserMenu(false)}
                          >
                            <TrendingUp className="w-4 h-4" />
                            Earnings
                          </Link>
                        </>
                      )}

                      {user.role === 'vendor' && (
                        <>
                          <hr className="my-2 border-card-border" />
                          <div className="px-4 py-2 text-xs font-semibold text-muted uppercase tracking-wider">
                            Vendor
                          </div>
                          <Link
                            to="/vendor/dashboard"
                            className="flex items-center gap-2 px-4 py-2 text-sm text-text hover:bg-card/50 transition-colors"
                            onClick={() => setShowUserMenu(false)}
                          >
                            <LayoutDashboard className="w-4 h-4" />
                            Dashboard
                          </Link>
                          <Link
                            to="/vendor/messages"
                            className="flex items-center gap-2 px-4 py-2 text-sm text-text hover:bg-card/50 transition-colors"
                            onClick={() => setShowUserMenu(false)}
                          >
                            <MessageSquare className="w-4 h-4" />
                            Customer Messages
                          </Link>
                          <Link
                            to="/vendor/payouts"
                            className="flex items-center gap-2 px-4 py-2 text-sm text-text hover:bg-card/50 transition-colors"
                            onClick={() => setShowUserMenu(false)}
                          >
                            <CreditCard className="w-4 h-4" />
                            Payouts
                          </Link>
                          <Link
                            to="/admin/kiosk-analytics"
                            className="flex items-center gap-2 px-4 py-2 text-sm text-text hover:bg-card/50 transition-colors"
                            onClick={() => setShowUserMenu(false)}
                          >
                            <BarChart3 className="w-4 h-4" />
                            Kiosk Analytics
                          </Link>
                        </>
                      )}

                      {(user.role === 'admin' || user.role === 'manager') && (
                        <>
                          <hr className="my-2 border-card-border" />
                          <div className="px-4 py-2 text-xs font-semibold text-muted uppercase tracking-wider">
                            Admin
                          </div>
                          <Link
                            to="/admin/dashboard"
                            className="flex items-center gap-2 px-4 py-2 text-sm text-text hover:bg-card/50 transition-colors"
                            onClick={() => setShowUserMenu(false)}
                          >
                            <LayoutDashboard className="w-4 h-4" />
                            Dashboard
                          </Link>
                          <Link
                            to="/admin/control-panel"
                            className="flex items-center gap-2 px-4 py-2 text-sm text-text hover:bg-card/50 transition-colors"
                            onClick={() => setShowUserMenu(false)}
                          >
                            <Settings className="w-4 h-4" />
                            Control Panel
                          </Link>
                          <Link
                            to="/admin/orders"
                            className="flex items-center gap-2 px-4 py-2 text-sm text-text hover:bg-card/50 transition-colors"
                            onClick={() => setShowUserMenu(false)}
                          >
                            <ClipboardList className="w-4 h-4" />
                            Order Management
                          </Link>
                          <Link
                            to="/admin/crm"
                            className="flex items-center gap-2 px-4 py-2 text-sm text-text hover:bg-card/50 transition-colors"
                            onClick={() => setShowUserMenu(false)}
                          >
                            <UsersRound className="w-4 h-4" />
                            CRM & Customers
                          </Link>
                          <Link
                            to="/admin/marketing"
                            className="flex items-center gap-2 px-4 py-2 text-sm text-text hover:bg-card/50 transition-colors"
                            onClick={() => setShowUserMenu(false)}
                          >
                            <Megaphone className="w-4 h-4" />
                            Marketing Tools
                          </Link>
                          <Link
                            to="/admin/products"
                            className="flex items-center gap-2 px-4 py-2 text-sm text-text hover:bg-card/50 transition-colors"
                            onClick={() => setShowUserMenu(false)}
                          >
                            <Package className="w-4 h-4" />
                            Product Management
                          </Link>
                          {user.role === 'admin' && (
                            <>
                              <Link
                                to="/admin/cost-override"
                                className="flex items-center gap-2 px-4 py-2 text-sm text-text hover:bg-card/50 transition-colors"
                                onClick={() => setShowUserMenu(false)}
                              >
                                <DollarSign className="w-4 h-4" />
                                Cost Override
                              </Link>
                              <Link
                                to="/admin/kiosks"
                                className="flex items-center gap-2 px-4 py-2 text-sm text-text hover:bg-card/50 transition-colors"
                                onClick={() => setShowUserMenu(false)}
                              >
                                <Monitor className="w-4 h-4" />
                                Kiosk Management
                              </Link>
                              <Link
                                to="/admin/kiosk-analytics"
                                className="flex items-center gap-2 px-4 py-2 text-sm text-text hover:bg-card/50 transition-colors"
                                onClick={() => setShowUserMenu(false)}
                              >
                                <BarChart3 className="w-4 h-4" />
                                Kiosk Analytics
                              </Link>
                              <Link
                                to="/admin/social-content"
                                className="flex items-center gap-2 px-4 py-2 text-sm text-text hover:bg-card/50 transition-colors"
                                onClick={() => setShowUserMenu(false)}
                              >
                                <Share2 className="w-4 h-4" />
                                Social Content
                              </Link>
                              <Link
                                to="/admin/ai/products/create"
                                className="flex items-center gap-2 px-4 py-2 text-sm text-text hover:bg-card/50 transition-colors"
                                onClick={() => setShowUserMenu(false)}
                              >
                                <Sparkles className="w-4 h-4" />
                                AI Product Builder
                              </Link>
                            </>
                          )}
                        </>
                      )}

                      {(user.role === 'manager' || user.role === 'admin' || user.role === 'founder') && (
                        <>
                          <hr className="my-2 border-card-border" />
                          <div className="px-4 py-2 text-xs font-semibold text-muted uppercase tracking-wider">
                            Manager
                          </div>
                          <Link
                            to="/manager/dashboard"
                            className="flex items-center gap-2 px-4 py-2 text-sm text-text hover:bg-card/50 transition-colors"
                            onClick={() => setShowUserMenu(false)}
                          >
                            <DollarSign className="w-4 h-4" />
                            Cost Controls
                          </Link>
                        </>
                      )}

                      {user.role === 'wholesale' && (
                        <>
                          <hr className="my-2 border-card-border" />
                          <div className="px-4 py-2 text-xs font-semibold text-muted uppercase tracking-wider">
                            Business
                          </div>
                          <Link
                            to="/wholesale"
                            className="flex items-center gap-2 px-4 py-2 text-sm text-text hover:bg-card/50 transition-colors"
                            onClick={() => setShowUserMenu(false)}
                          >
                            <Package className="w-4 h-4" />
                            Wholesale Portal
                          </Link>
                        </>
                      )}
                      <hr className="my-2 border-card-border" />
                      <button
                        onClick={() => {
                          signOut()
                          setShowUserMenu(false)
                        }}
                        className="w-full flex items-center gap-2 text-left px-4 py-2 text-sm text-red-500 hover:bg-card/50 transition-colors"
                      >
                        <LogOut className="w-4 h-4" />
                        Sign Out
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <Link
                to="/login"
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-primary to-secondary text-white font-semibold hover:shadow-glow transition-all hover:scale-[1.02]"
              >
                Sign In
              </Link>
            )}
          </div>
        </div>
      </div>

      <DesignStudioModal
        isOpen={showDesignModal}
        onClose={() => setShowDesignModal(false)}
      />
    </header>
  )
}

