import { Link, useLocation } from 'react-router-dom'
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
  CreditCard,
  Menu,
  X
} from 'lucide-react'
export function Header() {
  const { user, signOut } = useAuth()
  const { state: cartState } = useCart()
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showDesignModal, setShowDesignModal] = useState(false)
  const [showMobileMenu, setShowMobileMenu] = useState(false)
  const [isScrolled, setIsScrolled] = useState(false)
  const location = useLocation()

  // Pages that need a dark header (non-transparent) or dark text by default because they have light backgrounds
  const forceDarkHeader = ['/create-design', '/cart', '/checkout', '/account', '/product', '/catalog'].some(path => location.pathname.startsWith(path))

  // Track scroll for header background
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20)
    }
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

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

  // Calculate cart count (with safety check)
  const cartCount = cartState ? cartState.items.reduce((sum: number, item: any) => sum + item.quantity, 0) : 0

  return (
    <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${(isScrolled || forceDarkHeader)
      ? 'bg-white/95 backdrop-blur-lg shadow-soft border-b border-purple-100/50'
      : 'bg-transparent'
      }`}>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20">
          {/* Logo */}
          <Link to="/" className="flex items-center space-x-2">
            <img
              src="/itp-logo-v3.png"
              alt="Imagine This Printed"
              className="h-10 w-auto"
            />
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden lg:flex items-center gap-1">
            <Link
              to="/catalog"
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all duration-300 ${(isScrolled || forceDarkHeader)
                ? 'text-text hover:bg-purple-50 hover:text-purple-600'
                : 'text-white/90 hover:bg-white/10 hover:text-white'
                }`}
            >
              <ShoppingBag className="w-4 h-4" />
              Products
            </Link>
            <button
              onClick={() => setShowDesignModal(true)}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all duration-300 ${(isScrolled || forceDarkHeader)
                ? 'text-text hover:bg-purple-50 hover:text-purple-600'
                : 'text-white/90 hover:bg-white/10 hover:text-white'
                }`}
            >
              <Palette className="w-4 h-4" />
              Design Studio
            </button>
            <Link
              to="/community"
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all duration-300 ${(isScrolled || forceDarkHeader)
                ? 'text-text hover:bg-purple-50 hover:text-purple-600'
                : 'text-white/90 hover:bg-white/10 hover:text-white'
                }`}
            >
              <Users className="w-4 h-4" />
              Community
            </Link>
          </nav>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {/* Wallet Button */}
            {user && (
              <Link
                to="/wallet"
                className={`relative p-2.5 rounded-full transition-all duration-300 ${(isScrolled || forceDarkHeader)
                  ? 'bg-purple-50 hover:bg-purple-100 text-purple-600'
                  : 'bg-white/10 hover:bg-white/20 text-white'
                  }`}
                aria-label="Wallet"
              >
                <Wallet className="w-5 h-5" />
                {user.wallet && user.wallet.itcBalance > 0 && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 bg-pink-500 text-white text-xs font-bold rounded-full flex items-center justify-center shadow-lg">
                    {user.wallet.itcBalance > 99 ? '99+' : user.wallet.itcBalance}
                  </span>
                )}
              </Link>
            )}

            {/* Cart Button */}
            <Link
              to="/cart"
              className={`relative p-2.5 rounded-full transition-all duration-300 ${(isScrolled || forceDarkHeader)
                ? 'bg-purple-50 hover:bg-purple-100 text-purple-600'
                : 'bg-white/10 hover:bg-white/20 text-white'
                }`}
              aria-label="Shopping cart"
            >
              <ShoppingCart className="w-5 h-5" />
              {cartCount > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-pink-500 text-white text-xs font-bold rounded-full flex items-center justify-center shadow-lg">
                  {cartCount}
                </span>
              )}
            </Link>

            {/* User Menu or Sign In */}
            {user ? (
              <div className="relative">
                <button
                  onClick={() => setShowUserMenu(!showUserMenu)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-full transition-all duration-300 ${(isScrolled || forceDarkHeader)
                    ? 'bg-purple-50 hover:bg-purple-100'
                    : 'bg-white/10 hover:bg-white/20'
                    }`}
                >
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-semibold text-sm shadow-lg">
                    {user.username?.charAt(0).toUpperCase() || 'U'}
                  </div>
                  <span className={`hidden md:block text-sm font-medium ${(isScrolled || forceDarkHeader) ? 'text-text' : 'text-white'
                    }`}>
                    {user.username}
                  </span>
                  <ChevronDown className={`w-4 h-4 ${(isScrolled || forceDarkHeader) ? 'text-muted' : 'text-white/70'}`} />
                </button>

                {/* Dropdown Menu */}
                {showUserMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setShowUserMenu(false)}
                    ></div>
                    <div className="absolute right-0 mt-2 w-64 bg-white rounded-2xl shadow-soft-xl border border-purple-100/50 py-2 z-20 overflow-hidden">
                      {/* User header */}
                      <div className="px-4 py-3 border-b border-purple-50">
                        <p className="text-sm font-semibold text-text">{user.username}</p>
                        <p className="text-xs text-muted">{user.email}</p>
                      </div>

                      <div className="py-2">
                        <Link
                          to="/account/profile"
                          className="flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-purple-50 transition-colors"
                          onClick={() => setShowUserMenu(false)}
                        >
                          <User className="w-4 h-4 text-purple-500" />
                          My Profile
                        </Link>
                        <Link
                          to="/wallet"
                          className="flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-purple-50 transition-colors"
                          onClick={() => setShowUserMenu(false)}
                        >
                          <Wallet className="w-4 h-4 text-purple-500" />
                          Wallet
                        </Link>
                        <Link
                          to="/orders"
                          className="flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-purple-50 transition-colors"
                          onClick={() => setShowUserMenu(false)}
                        >
                          <FileText className="w-4 h-4 text-purple-500" />
                          Orders
                        </Link>
                      </div>

                      {/* Role-specific dashboards */}
                      {user.role === 'founder' && (
                        <div className="py-2 border-t border-purple-50">
                          <div className="px-4 py-2 text-xs font-semibold text-muted uppercase tracking-wider">
                            Founder
                          </div>
                          <Link
                            to="/founder/dashboard"
                            className="flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-purple-50 transition-colors"
                            onClick={() => setShowUserMenu(false)}
                          >
                            <LayoutDashboard className="w-4 h-4 text-purple-500" />
                            Dashboard
                          </Link>
                          <Link
                            to="/founder/earnings"
                            className="flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-purple-50 transition-colors"
                            onClick={() => setShowUserMenu(false)}
                          >
                            <TrendingUp className="w-4 h-4 text-purple-500" />
                            Earnings
                          </Link>
                        </div>
                      )}

                      {user.role === 'vendor' && (
                        <div className="py-2 border-t border-purple-50">
                          <div className="px-4 py-2 text-xs font-semibold text-muted uppercase tracking-wider">
                            Vendor
                          </div>
                          <Link
                            to="/vendor/dashboard"
                            className="flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-purple-50 transition-colors"
                            onClick={() => setShowUserMenu(false)}
                          >
                            <LayoutDashboard className="w-4 h-4 text-purple-500" />
                            Dashboard
                          </Link>
                          <Link
                            to="/vendor/messages"
                            className="flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-purple-50 transition-colors"
                            onClick={() => setShowUserMenu(false)}
                          >
                            <MessageSquare className="w-4 h-4 text-purple-500" />
                            Customer Messages
                          </Link>
                          <Link
                            to="/vendor/payouts"
                            className="flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-purple-50 transition-colors"
                            onClick={() => setShowUserMenu(false)}
                          >
                            <CreditCard className="w-4 h-4 text-purple-500" />
                            Payouts
                          </Link>
                          <Link
                            to="/admin/kiosk-analytics"
                            className="flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-purple-50 transition-colors"
                            onClick={() => setShowUserMenu(false)}
                          >
                            <BarChart3 className="w-4 h-4 text-purple-500" />
                            Kiosk Analytics
                          </Link>
                        </div>
                      )}

                      {(user.role === 'admin' || user.role === 'manager') && (
                        <div className="py-2 border-t border-purple-50">
                          <div className="px-4 py-2 text-xs font-semibold text-muted uppercase tracking-wider">
                            Admin
                          </div>
                          <Link
                            to="/admin/dashboard"
                            className="flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-purple-50 transition-colors"
                            onClick={() => setShowUserMenu(false)}
                          >
                            <LayoutDashboard className="w-4 h-4 text-purple-500" />
                            Dashboard
                          </Link>
                          <Link
                            to="/admin/control-panel"
                            className="flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-purple-50 transition-colors"
                            onClick={() => setShowUserMenu(false)}
                          >
                            <Settings className="w-4 h-4 text-purple-500" />
                            Control Panel
                          </Link>
                          <Link
                            to="/admin/orders"
                            className="flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-purple-50 transition-colors"
                            onClick={() => setShowUserMenu(false)}
                          >
                            <ClipboardList className="w-4 h-4 text-purple-500" />
                            Order Management
                          </Link>
                          <Link
                            to="/admin/crm"
                            className="flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-purple-50 transition-colors"
                            onClick={() => setShowUserMenu(false)}
                          >
                            <UsersRound className="w-4 h-4 text-purple-500" />
                            CRM & Customers
                          </Link>
                          <Link
                            to="/admin/marketing"
                            className="flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-purple-50 transition-colors"
                            onClick={() => setShowUserMenu(false)}
                          >
                            <Megaphone className="w-4 h-4 text-purple-500" />
                            Marketing Tools
                          </Link>
                          <Link
                            to="/admin/products"
                            className="flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-purple-50 transition-colors"
                            onClick={() => setShowUserMenu(false)}
                          >
                            <Package className="w-4 h-4 text-purple-500" />
                            Product Management
                          </Link>
                          {user.role === 'admin' && (
                            <>
                              <Link
                                to="/admin/cost-override"
                                className="flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-purple-50 transition-colors"
                                onClick={() => setShowUserMenu(false)}
                              >
                                <DollarSign className="w-4 h-4 text-purple-500" />
                                Cost Override
                              </Link>
                              <Link
                                to="/admin/kiosks"
                                className="flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-purple-50 transition-colors"
                                onClick={() => setShowUserMenu(false)}
                              >
                                <Monitor className="w-4 h-4 text-purple-500" />
                                Kiosk Management
                              </Link>
                              <Link
                                to="/admin/kiosk-analytics"
                                className="flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-purple-50 transition-colors"
                                onClick={() => setShowUserMenu(false)}
                              >
                                <BarChart3 className="w-4 h-4 text-purple-500" />
                                Kiosk Analytics
                              </Link>
                              <Link
                                to="/admin/social-content"
                                className="flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-purple-50 transition-colors"
                                onClick={() => setShowUserMenu(false)}
                              >
                                <Share2 className="w-4 h-4 text-purple-500" />
                                Social Content
                              </Link>
                              <Link
                                to="/admin/ai/products/create"
                                className="flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-purple-50 transition-colors"
                                onClick={() => setShowUserMenu(false)}
                              >
                                <Sparkles className="w-4 h-4 text-purple-500" />
                                AI Product Builder
                              </Link>
                            </>
                          )}
                        </div>
                      )}

                      {(user.role === 'manager' || user.role === 'admin' || user.role === 'founder') && (
                        <div className="py-2 border-t border-purple-50">
                          <div className="px-4 py-2 text-xs font-semibold text-muted uppercase tracking-wider">
                            Manager
                          </div>
                          <Link
                            to="/manager/dashboard"
                            className="flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-purple-50 transition-colors"
                            onClick={() => setShowUserMenu(false)}
                          >
                            <DollarSign className="w-4 h-4 text-purple-500" />
                            Cost Controls
                          </Link>
                        </div>
                      )}

                      {user.role === 'wholesale' && (
                        <div className="py-2 border-t border-purple-50">
                          <div className="px-4 py-2 text-xs font-semibold text-muted uppercase tracking-wider">
                            Business
                          </div>
                          <Link
                            to="/wholesale"
                            className="flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-purple-50 transition-colors"
                            onClick={() => setShowUserMenu(false)}
                          >
                            <Package className="w-4 h-4 text-purple-500" />
                            Wholesale Portal
                          </Link>
                        </div>
                      )}

                      <div className="py-2 border-t border-purple-50">
                        <button
                          onClick={() => {
                            signOut()
                            setShowUserMenu(false)
                          }}
                          className="w-full flex items-center gap-3 text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                        >
                          <LogOut className="w-4 h-4" />
                          Sign Out
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <Link
                to="/login"
                className="px-5 py-2.5 rounded-full bg-gradient-to-r from-purple-500 to-purple-600 text-white text-sm font-semibold hover:from-purple-600 hover:to-purple-700 transition-all shadow-lg shadow-purple-200 hover:shadow-xl hover:-translate-y-0.5"
              >
                Sign In
              </Link>
            )}

            {/* Mobile Menu Button */}
            <button
              onClick={() => setShowMobileMenu(!showMobileMenu)}
              className={`lg:hidden p-2.5 rounded-full transition-all duration-300 ${(isScrolled || forceDarkHeader)
                ? 'bg-purple-50 hover:bg-purple-100 text-purple-600'
                : 'bg-white/10 hover:bg-white/20 text-white'
                }`}
            >
              {showMobileMenu ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      {showMobileMenu && (
        <div className="lg:hidden bg-white border-t border-purple-100 shadow-soft-lg">
          <nav className="px-4 py-4 space-y-1">
            <Link
              to="/catalog"
              className="flex items-center gap-3 px-4 py-3 text-text hover:bg-purple-50 rounded-xl transition-colors"
              onClick={() => setShowMobileMenu(false)}
            >
              <ShoppingBag className="w-5 h-5 text-purple-500" />
              Products
            </Link>
            <button
              onClick={() => {
                setShowDesignModal(true)
                setShowMobileMenu(false)
              }}
              className="w-full flex items-center gap-3 px-4 py-3 text-text hover:bg-purple-50 rounded-xl transition-colors"
            >
              <Palette className="w-5 h-5 text-purple-500" />
              Design Studio
            </button>
            <Link
              to="/community"
              className="flex items-center gap-3 px-4 py-3 text-text hover:bg-purple-50 rounded-xl transition-colors"
              onClick={() => setShowMobileMenu(false)}
            >
              <Users className="w-5 h-5 text-purple-500" />
              Community
            </Link>
          </nav>
        </div>
      )}

      <DesignStudioModal
        isOpen={showDesignModal}
        onClose={() => setShowDesignModal(false)}
      />
    </header>
  )
}
