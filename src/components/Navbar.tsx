import React, { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import { useCart } from '../context/CartContext'
import { useAuth } from '../context/SupabaseAuthContext'

const Navbar: React.FC = () => {
  const { state } = useCart()
  const { user, signOut } = useAuth()
  const [showAccountMenu, setShowAccountMenu] = useState(false)
  const [showMobileMenu, setShowMobileMenu] = useState(false)
  const accountMenuRef = useRef<HTMLDivElement>(null)

  // DEBUG: Log user role on component mount and when user changes
  useEffect(() => {
    if (user) {
      console.log('[Navbar] 👤 User role check:', {
        email: user.email,
        role: user.role,
        roleType: typeof user.role,
        isAdmin: user.role === 'admin',
        isManager: user.role === 'manager',
        fullUser: user
      })
    }
  }, [user])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(event.target as Node)) {
        setShowAccountMenu(false)
      }
    }

    if (showAccountMenu) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showAccountMenu])

  const handleSignOut = async () => {
    try {
      await signOut()
      setShowAccountMenu(false)
    } catch (error) {
      console.error('Error signing out:', error)
    }
  }

  const toggleAccountMenu = () => {
    setShowAccountMenu(!showAccountMenu)
  }

  const closeAccountMenu = () => {
    setShowAccountMenu(false)
  }

  const closeMobileMenu = () => {
    setShowMobileMenu(false)
  }

  return (
    <nav className="bg-[#0f0a29] shadow-lg border-b border-white/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center">
            <Link to="/" className="flex-shrink-0">
              <img src="/itp-logo-v3.png" alt="Imagine This Printed" className="h-12 w-auto object-contain" />
            </Link>
          </div>

          <div className="hidden md:flex items-center space-x-8">
            <Link to="/" className="text-gray-300 hover:text-white hover:bg-white/10 px-3 py-2 rounded-md text-sm font-medium transition-colors">
              Home
            </Link>
            <Link to="/catalog" className="text-gray-300 hover:text-white hover:bg-white/10 px-3 py-2 rounded-md text-sm font-medium transition-colors">
              Products
            </Link>
            <Link
              to="/imagination-station"
              className="text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 transition-all shadow-lg hover:shadow-purple-500/25"
            >
              <Sparkles className="w-4 h-4" />
              Imagination Station
            </Link>
            <Link to="/models" className="text-gray-700 hover:text-purple-600 px-3 py-2 rounded-md text-sm font-medium">
              3D Models
            </Link>
            <Link to="/community" className="text-gray-700 hover:text-purple-600 px-3 py-2 rounded-md text-sm font-medium">
              Community
            </Link>
            <Link to="/wholesale" className="text-gray-700 hover:text-purple-600 px-3 py-2 rounded-md text-sm font-medium">
              Wholesale
            </Link>
            {user && (
              <>
                <Link to="/my-designs" className="text-gray-300 hover:text-white hover:bg-white/10 px-3 py-2 rounded-md text-sm font-medium transition-colors">
                  My Designs
                </Link>
                <Link to="/wallet" className="text-gray-300 hover:text-white hover:bg-white/10 px-3 py-2 rounded-md text-sm font-medium transition-colors">
                  Wallet
                </Link>
              </>
            )}
            <Link to="/cart" className="relative text-gray-700 hover:text-purple-600 px-3 py-2 rounded-md text-sm font-medium">
              Cart
              {state.items.length > 0 && (
                <span className="absolute -top-1 -right-1 bg-purple-600 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
                  {state.items.reduce((sum, item) => sum + item.quantity, 0)}
                </span>
              )}
            </Link>

            {user ? (
              <div className="relative" ref={accountMenuRef}>
                <button
                  onClick={toggleAccountMenu}
                  className="flex items-center text-gray-300 hover:text-white px-3 py-2 rounded-md text-sm font-medium gap-2"
                >
                  {/* Profile Avatar */}
                  {user.avatar_url ? (
                    <img
                      src={user.avatar_url}
                      alt={user.username || 'Profile'}
                      className="w-7 h-7 rounded-full object-cover border-2 border-purple-500/50"
                    />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-xs font-bold">
                      {user.username?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase() || '?'}
                    </div>
                  )}
                  <span className="hidden lg:inline">{user.username || 'Account'}</span>
                  <svg className={`w-4 h-4 transition-transform ${showAccountMenu ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showAccountMenu && (
                  <div className="absolute right-0 mt-2 w-56 bg-white rounded-md shadow-lg py-1 z-10 border border-gray-200">
                    <div className="px-4 py-3 text-sm text-gray-700 border-b flex items-center gap-3">
                      {/* Dropdown header with avatar */}
                      {user.avatar_url ? (
                        <img
                          src={user.avatar_url}
                          alt={user.username || 'Profile'}
                          className="w-10 h-10 rounded-full object-cover border-2 border-purple-200"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold">
                          {user.username?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase() || '?'}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{user.username || user.email}</div>
                        <div className="text-xs text-gray-500">
                          <span className="capitalize font-semibold">{user.role?.replace('_', ' ')}</span>
                          {user.role === 'admin' && <span className="ml-1 text-green-600">✓</span>}
                          {user.role === 'manager' && <span className="ml-1 text-blue-600">✓</span>}
                          {user.role === 'support_agent' && <span className="ml-1 text-purple-600">✓</span>}
                        </div>
                      </div>
                    </div>

                    {/* Account Section */}
                    <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Account
                    </div>
                    <Link
                      to="/account/profile"
                      onClick={closeAccountMenu}
                      className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      My Profile
                    </Link>
                    <Link
                      to="/account/messages"
                      onClick={closeAccountMenu}
                      className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      Messages
                    </Link>
                    <Link
                      to="/wallet"
                      onClick={closeAccountMenu}
                      className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      Wallet & Rewards
                    </Link>
                    <Link
                      to="/referrals"
                      onClick={closeAccountMenu}
                      className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      Referral Program
                    </Link>

                    {/* Role-specific dashboards */}
                    {user.role === 'founder' && (
                      <>
                        <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider border-t mt-2 pt-2">
                          Founder
                        </div>
                        <Link
                          to="/founder/dashboard"
                          onClick={closeAccountMenu}
                          className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        >
                          Dashboard
                        </Link>
                        <Link
                          to="/founder/earnings"
                          onClick={closeAccountMenu}
                          className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        >
                          Earnings
                        </Link>
                      </>
                    )}

                    {user.role === 'vendor' && (
                      <>
                        <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider border-t mt-2 pt-2">
                          Vendor
                        </div>
                        <Link
                          to="/vendor/dashboard"
                          onClick={closeAccountMenu}
                          className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        >
                          Dashboard
                        </Link>
                        <Link
                          to="/vendor/messages"
                          onClick={closeAccountMenu}
                          className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        >
                          Customer Messages
                        </Link>
                        <Link
                          to="/vendor/payouts"
                          onClick={closeAccountMenu}
                          className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        >
                          Payouts
                        </Link>
                        <Link
                          to="/admin/kiosk-analytics"
                          onClick={closeAccountMenu}
                          className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        >
                          Kiosk Analytics
                        </Link>
                      </>
                    )}

                    {(user.role === 'admin' || user.role === 'manager') && (
                      <>
                        <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider border-t mt-2 pt-2">
                          Admin
                        </div>
                        <Link
                          to="/admin/dashboard"
                          onClick={closeAccountMenu}
                          className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        >
                          Dashboard
                        </Link>
                        <Link
                          to="/admin/control-panel"
                          onClick={closeAccountMenu}
                          className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        >
                          Control Panel
                        </Link>
                        <Link
                          to="/admin/orders"
                          onClick={closeAccountMenu}
                          className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        >
                          Order Management
                        </Link>
                        <Link
                          to="/admin/crm"
                          onClick={closeAccountMenu}
                          className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        >
                          CRM & Customers
                        </Link>
                        <Link
                          to="/admin/marketing"
                          onClick={closeAccountMenu}
                          className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        >
                          Marketing Tools
                        </Link>
                        <Link
                          to="/admin?tab=products"
                          onClick={closeAccountMenu}
                          className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        >
                          Product Management
                        </Link>
                        {user.role === 'admin' && (
                          <>
                            <Link
                              to="/admin/cost-override"
                              onClick={closeAccountMenu}
                              className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                            >
                              Cost Override
                            </Link>
                            <Link
                              to="/admin/kiosks"
                              onClick={closeAccountMenu}
                              className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                            >
                              Kiosk Management
                            </Link>
                            <Link
                              to="/admin/kiosk-analytics"
                              onClick={closeAccountMenu}
                              className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                            >
                              Kiosk Analytics
                            </Link>
                            <Link
                              to="/admin/social-content"
                              onClick={closeAccountMenu}
                              className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                            >
                              Social Content
                            </Link>
                            <Link
                              to="/admin/ai/products/create"
                              onClick={closeAccountMenu}
                              className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                            >
                              AI Product Builder
                            </Link>
                          </>
                        )}
                      </>
                    )}

                    {(user.role === 'manager' || user.role === 'admin' || user.role === 'founder') && (
                      <>
                        <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider border-t mt-2 pt-2">
                          Manager
                        </div>
                        <Link
                          to="/manager/dashboard"
                          onClick={closeAccountMenu}
                          className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        >
                          Cost Controls
                        </Link>
                      </>
                    )}

                    {user.role === 'wholesale' && (
                      <>
                        <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider border-t mt-2 pt-2">
                          Business
                        </div>
                        <Link
                          to="/wholesale"
                          onClick={closeAccountMenu}
                          className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        >
                          Wholesale Portal
                        </Link>
                      </>
                    )}

                    {user.role === 'support_agent' && (
                      <>
                        <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider border-t mt-2 pt-2">
                          Support
                        </div>
                        <Link
                          to="/admin?tab=support"
                          onClick={closeAccountMenu}
                          className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        >
                          Support Dashboard
                        </Link>
                      </>
                    )}

                    <div className="border-t mt-2 pt-2">
                      <button
                        onClick={handleSignOut}
                        className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                      >
                        Sign Out
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex space-x-2">
                <Link
                  to="/login"
                  className="text-gray-700 hover:text-purple-600 px-3 py-2 rounded-md text-sm font-medium"
                >
                  Sign In
                </Link>
                <Link
                  to="/signup"
                  className="btn-primary text-sm"
                >
                  Sign Up
                </Link>
              </div>
            )}
          </div>

          {/* Mobile menu button + cart */}
          <div className="md:hidden flex items-center gap-2">
            {/* Mobile Cart */}
            <Link to="/cart" className="relative text-gray-300 hover:text-white p-2" onClick={closeMobileMenu}>
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              {state.items.length > 0 && (
                <span className="absolute -top-1 -right-1 bg-purple-600 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
                  {state.items.reduce((sum, item) => sum + item.quantity, 0)}
                </span>
              )}
            </Link>

            {/* Hamburger button */}
            <button
              type="button"
              onClick={() => setShowMobileMenu(!showMobileMenu)}
              className="bg-white/10 p-2 rounded-md text-gray-300 hover:text-white hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-purple-500"
            >
              {showMobileMenu ? (
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu Dropdown */}
      {showMobileMenu && (
        <div className="md:hidden bg-[#0f0a29] border-t border-white/10">
          <div className="px-4 py-3 space-y-1">
            {/* Main Navigation */}
            <Link to="/" onClick={closeMobileMenu} className="block px-3 py-2 text-gray-300 hover:text-white hover:bg-white/10 rounded-md text-base font-medium">
              Home
            </Link>
            <Link to="/catalog" onClick={closeMobileMenu} className="block px-3 py-2 text-gray-300 hover:text-white hover:bg-white/10 rounded-md text-base font-medium">
              Products
            </Link>
            <Link to="/imagination-station" onClick={closeMobileMenu} className="flex items-center gap-2 px-3 py-2 text-white bg-gradient-to-r from-purple-600 to-pink-600 rounded-md text-base font-medium">
              <Sparkles className="w-4 h-4" />
              Imagination Station
            </Link>
            <Link to="/models" onClick={closeMobileMenu} className="block px-3 py-2 text-gray-300 hover:text-white hover:bg-white/10 rounded-md text-base font-medium">
              3D Models
            </Link>
            <Link to="/community" onClick={closeMobileMenu} className="block px-3 py-2 text-gray-300 hover:text-white hover:bg-white/10 rounded-md text-base font-medium">
              Community
            </Link>

            {user && (
              <>
                <div className="border-t border-white/10 my-2 pt-2">
                  <Link to="/my-designs" onClick={closeMobileMenu} className="block px-3 py-2 text-gray-300 hover:text-white hover:bg-white/10 rounded-md text-base font-medium">
                    My Designs
                  </Link>
                  <Link to="/wallet" onClick={closeMobileMenu} className="block px-3 py-2 text-gray-300 hover:text-white hover:bg-white/10 rounded-md text-base font-medium">
                    Wallet
                  </Link>
                  <Link to="/account/profile" onClick={closeMobileMenu} className="block px-3 py-2 text-gray-300 hover:text-white hover:bg-white/10 rounded-md text-base font-medium">
                    My Profile
                  </Link>
                  <Link to="/account/messages" onClick={closeMobileMenu} className="block px-3 py-2 text-gray-300 hover:text-white hover:bg-white/10 rounded-md text-base font-medium">
                    Messages
                  </Link>
                </div>

                {/* Role-specific links */}
                {(user.role === 'admin' || user.role === 'manager') && (
                  <div className="border-t border-white/10 my-2 pt-2">
                    <p className="px-3 py-1 text-xs text-purple-400 uppercase tracking-wider">Admin</p>
                    <Link to="/admin/dashboard" onClick={closeMobileMenu} className="block px-3 py-2 text-gray-300 hover:text-white hover:bg-white/10 rounded-md text-base font-medium">
                      Dashboard
                    </Link>
                    <Link to="/admin/orders" onClick={closeMobileMenu} className="block px-3 py-2 text-gray-300 hover:text-white hover:bg-white/10 rounded-md text-base font-medium">
                      Orders
                    </Link>
                  </div>
                )}

                <div className="border-t border-white/10 my-2 pt-2">
                  <button
                    onClick={() => { handleSignOut(); closeMobileMenu(); }}
                    className="block w-full text-left px-3 py-2 text-red-400 hover:text-red-300 hover:bg-white/10 rounded-md text-base font-medium"
                  >
                    Sign Out
                  </button>
                </div>
              </>
            )}

            {!user && (
              <div className="border-t border-white/10 my-2 pt-2 flex gap-2">
                <Link to="/login" onClick={closeMobileMenu} className="flex-1 text-center px-3 py-2 text-gray-300 hover:text-white border border-white/20 rounded-md text-base font-medium">
                  Sign In
                </Link>
                <Link to="/signup" onClick={closeMobileMenu} className="flex-1 text-center px-3 py-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-md text-base font-medium">
                  Sign Up
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </nav>
  )
}

export default Navbar
