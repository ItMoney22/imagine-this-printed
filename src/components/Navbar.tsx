import React, { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Palette } from 'lucide-react'
import { useCart } from '../context/CartContext'
import { useAuth } from '../context/SupabaseAuthContext'
import DesignStudioModal from './DesignStudioModal'

const Navbar: React.FC = () => {
  const { state } = useCart()
  const { user, signOut } = useAuth()
  const [showAccountMenu, setShowAccountMenu] = useState(false)
  const [showDesignModal, setShowDesignModal] = useState(false)
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

  return (
    <nav className="bg-[#0f0a29] shadow-lg border-b border-white/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center">
            <Link to="/" className="flex-shrink-0">
              <img src="/logo-tech.png" alt="Imagine This Printed" className="h-12 w-auto object-contain" />
            </Link>
          </div>

          <div className="hidden md:flex items-center space-x-8">
            <Link to="/" className="text-gray-300 hover:text-white hover:bg-white/10 px-3 py-2 rounded-md text-sm font-medium transition-colors">
              Home
            </Link>
            <Link to="/catalog" className="text-gray-300 hover:text-white hover:bg-white/10 px-3 py-2 rounded-md text-sm font-medium transition-colors">
              Products
            </Link>
            <button
              onClick={() => setShowDesignModal(true)}
              className="text-gray-700 hover:text-purple-600 px-3 py-2 rounded-md text-sm font-medium flex items-center gap-1.5 bg-gradient-to-r from-purple-600/10 to-pink-600/10 border border-purple-600/20 hover:border-purple-600/40 transition-all"
            >
              <Palette className="w-4 h-4" />
              Design Studio
            </button>
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
              <Link to="/wallet" className="text-gray-700 hover:text-purple-600 px-3 py-2 rounded-md text-sm font-medium">
                Wallet
              </Link>
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
                  className="flex items-center text-gray-700 hover:text-purple-600 px-3 py-2 rounded-md text-sm font-medium"
                >
                  <svg className="w-5 h-5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  Account
                  <svg className={`w-4 h-4 ml-1 transition-transform ${showAccountMenu ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showAccountMenu && (
                  <div className="absolute right-0 mt-2 w-56 bg-white rounded-md shadow-lg py-1 z-10 border border-gray-200">
                    <div className="px-4 py-2 text-sm text-gray-700 border-b">
                      <div className="font-medium">{user.email}</div>
                      <div className="text-xs text-gray-500">
                        Role: <span className="capitalize font-semibold">{user.role}</span>
                        {user.role === 'admin' && <span className="ml-2 text-green-600">✓ Admin</span>}
                        {user.role === 'manager' && <span className="ml-2 text-blue-600">✓ Manager</span>}
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

          <div className="md:hidden flex items-center">
            <button
              type="button"
              className="bg-gray-100 p-2 rounded-md text-gray-700 hover:text-purple-600 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-purple-500"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <DesignStudioModal
        isOpen={showDesignModal}
        onClose={() => setShowDesignModal(false)}
      />
    </nav>
  )
}

export default Navbar
