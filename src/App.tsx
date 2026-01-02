import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { SupabaseAuthProvider } from './context/SupabaseAuthContext'
import { CartProvider } from './context/CartContext'
import { KioskAuthProvider } from './context/KioskAuthContext'
import { ToastProvider } from './context/ToastContext'
import { SidebarProvider, useSidebar } from './context/SidebarContext'
import ErrorBoundary from './components/ErrorBoundary'
// import './utils/debug' // Auto-run debug utilities
// import './utils/connectivity-test' // Additional connectivity tests
// import './utils/env-check' // Environment diagnostic
import { Sidebar, MobileMenuButton } from './components/Sidebar'
import { Footer } from './components/Footer'
import KioskRoute from './components/KioskRoute'
import ProtectedRoute from './components/ProtectedRoute'
// import ChatBotWidget from './components/ChatBotWidget' // Replaced with Mr. Imagine
import { MrImagineChatWidget } from './components/MrImagineChatWidget'
import { MrImagineCartNotification } from './components/mr-imagine/MrImagineCartNotification'
import { MrImagineNotificationProvider } from './components/MrImagineNotification'
import { ToastContainer } from './components/ToastContainer'
import Home from './pages/Home'
import Login from './pages/Login'
import Signup from './pages/Signup'
import AuthCallback from './pages/AuthCallback'
import AuthError from './pages/AuthError'
import ProductCatalog from './pages/ProductCatalog'
import ProductPage from './pages/ProductPage'
// ProductDesigner discontinued - using ImaginationStation instead
import Cart from './pages/Cart'
import Checkout from './pages/Checkout'
import FoundersDashboard from './pages/FoundersDashboard'
import VendorDashboard from './pages/VendorDashboard'
import ModelGallery from './pages/ModelGallery'
import Wallet from './pages/Wallet'
import CRM from './pages/CRM'
import AdminDashboard from './pages/AdminDashboard'
import MarketingTools from './pages/MarketingTools'
import OrderManagement from './pages/OrderManagement'
import Referrals from './pages/Referrals'
import UserProfile from './pages/UserProfile'
import ProfileEdit from './pages/ProfileEdit'
import CustomerMessages from './pages/CustomerMessages'
import VendorMessages from './pages/VendorMessages'
import VendorPayouts from './pages/VendorPayouts'
import FounderEarningsPage from './pages/FounderEarnings'
import AdminControlPanel from './pages/AdminControlPanel'
import AdminEmailTemplates from './pages/AdminEmailTemplates'
import AdminPanel from './pages/AdminPanel'
import WholesalePortal from './pages/WholesalePortal'
import VendorStorefront from './pages/VendorStorefront'
// Removed: ProductManagement (duplicate of AdminDashboard Products tab)
import ManagerDashboard from './pages/ManagerDashboard'
import AdminCostOverride from './pages/AdminCostOverride'
import KioskManagement from './pages/KioskManagement'
import KioskAnalytics from './pages/KioskAnalytics'
import Community from './pages/Community'
import ImageDebug from './pages/ImageDebug'
import AdminAIProductBuilder from './pages/AdminAIProductBuilder'
import SocialContentManagement from './pages/SocialContentManagement'
import UserMediaGallery from './pages/UserMediaGallery'
// UserProductCreator discontinued - using ImaginationStation instead
import UserDesignDashboard from './pages/UserDesignDashboard'
import MyOrders from './pages/MyOrders'
import { AdminVoiceSettings } from './pages/admin/VoiceSettings'
import AdminImaginationProducts from './pages/admin/ImaginationProducts'
import ImaginationStation from './pages/ImaginationStation'
import { ImaginationErrorBoundary } from './components/imagination'
import OrderSuccess from './pages/OrderSuccess'
import Contact from './pages/Contact'
import PrivacyPolicy from './pages/PrivacyPolicy'
import TermsOfService from './pages/TermsOfService'
import ShippingPolicy from './pages/ShippingPolicy'
import ReturnsPolicy from './pages/ReturnsPolicy'
import CookieConsent from './components/CookieConsent'

// Routes that should hide the sidebar for full-screen experience
const FULL_SCREEN_ROUTES = ['/imagination-station', '/order-success', '/kiosk']

// Scroll to top on route change
function ScrollToTop() {
  const { pathname } = useLocation()

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return null
}

// Layout component that conditionally shows sidebar
function AppLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const { isCollapsed } = useSidebar()
  const isFullScreen = FULL_SCREEN_ROUTES.some(route => location.pathname.startsWith(route))

  return (
    <div className="min-h-screen bg-bg text-text flex">
      {!isFullScreen && <Sidebar />}
      {!isFullScreen && <MobileMenuButton />}
      <main
        className={`flex-1 min-w-0 overflow-x-hidden min-h-screen transition-all duration-300 ${
          !isFullScreen ? `pt-16 lg:pt-0 ${isCollapsed ? 'lg:ml-16' : 'lg:ml-60'}` : ''
        }`}
      >
        {children}
        {!isFullScreen && <Footer />}
      </main>
      {!isFullScreen && <MrImagineChatWidget />}
      <MrImagineCartNotification />
      <ToastContainer />
      <CookieConsent />
    </div>
  )
}

function App() {
  return (
    <ErrorBoundary>
      <SupabaseAuthProvider>
        <CartProvider>
          <KioskAuthProvider>
            <ToastProvider>
              <MrImagineNotificationProvider>
                <SidebarProvider>
                  <Router>
                    <ScrollToTop />
                    <AppLayout>
                <Routes>
                  <Route path="/" element={<Home />} />
                  <Route path="/login" element={<Login />} />
                  <Route path="/signup" element={<Signup />} />
                  <Route path="/auth/callback" element={<AuthCallback />} />
                  <Route path="/auth/error" element={<AuthError />} />
                  <Route path="/auth/reset-password" element={<AuthCallback />} />
                  <Route path="/catalog" element={<ProductCatalog />} />
                  <Route path="/catalog/:category" element={<ProductCatalog />} />
                  <Route path="/product/:id" element={<ProductPage />} />
                  {/* Redirect old design routes to Imagination Station */}
                  <Route path="/create-design" element={<Navigate to="/imagination-station" replace />} />
                  <Route path="/designer" element={<Navigate to="/imagination-station" replace />} />
                  <Route path="/cart" element={<Cart />} />
                  <Route path="/checkout" element={<Checkout />} />
                  <Route path="/order-success" element={<OrderSuccess />} />
                  <Route path="/founders" element={<FoundersDashboard />} />
                  <Route path="/vendor" element={<VendorDashboard />} />
                  <Route path="/models" element={<ProtectedRoute><ModelGallery /></ProtectedRoute>} />
                  <Route path="/3d-models" element={<ProtectedRoute><ModelGallery /></ProtectedRoute>} />
                  <Route path="/wallet" element={<Wallet />} />
                  <Route path="/crm" element={<CRM />} />
                  <Route path="/admin" element={<AdminDashboard />} />
                  <Route path="/marketing" element={<MarketingTools />} />
                  <Route path="/orders" element={<OrderManagement />} />
                  <Route path="/referrals" element={<Referrals />} />
                  <Route path="/contact" element={<Contact />} />
                  <Route path="/community" element={<ProtectedRoute><Community /></ProtectedRoute>} />

                  {/* Legal Pages */}
                  <Route path="/privacy" element={<PrivacyPolicy />} />
                  <Route path="/terms" element={<TermsOfService />} />
                  <Route path="/shipping" element={<ShippingPolicy />} />
                  <Route path="/returns" element={<ReturnsPolicy />} />

                  {/* Account & Profile Routes */}
                  <Route path="/account/profile" element={<UserProfile />} />
                  <Route path="/account/profile/edit" element={<ProfileEdit />} />
                  <Route path="/profile/:username" element={<UserProfile />} />
                  <Route path="/account/messages" element={<CustomerMessages />} />
                  <Route path="/account/media" element={<ProtectedRoute><UserMediaGallery /></ProtectedRoute>} />
                  <Route path="/account/designs" element={<ProtectedRoute><UserDesignDashboard /></ProtectedRoute>} />
                  <Route path="/my-designs" element={<ProtectedRoute><UserDesignDashboard /></ProtectedRoute>} />
                  <Route path="/account/orders" element={<ProtectedRoute><MyOrders /></ProtectedRoute>} />

                  {/* Vendor Routes */}
                  <Route path="/vendor/dashboard" element={<VendorDashboard />} />
                  <Route path="/vendor/messages" element={<VendorMessages />} />
                  <Route path="/vendor/payouts" element={<VendorPayouts />} />
                  <Route path="/vendor/storefront/:vendorId" element={<VendorStorefront />} />

                  {/* Founder Routes */}
                  <Route path="/founder/dashboard" element={<FoundersDashboard />} />
                  <Route path="/founder/earnings" element={<FounderEarningsPage />} />

                  {/* Admin Routes */}
                  <Route path="/admin/dashboard" element={<AdminDashboard />} />
                  <Route path="/admin/control-panel" element={<AdminControlPanel />} />
                  <Route path="/admin-panel" element={<AdminPanel />} />
                  <Route path="/admin/orders" element={<OrderManagement />} />
                  <Route path="/admin/crm" element={<CRM />} />
                  <Route path="/admin/marketing" element={<MarketingTools />} />
                  {/* Removed: /admin/products route - use AdminDashboard Products tab instead */}
                  <Route path="/admin/cost-override" element={<AdminCostOverride />} />
                  <Route path="/admin/kiosks" element={<KioskManagement />} />
                  <Route path="/admin/kiosk-analytics" element={<KioskAnalytics />} />
                  <Route path="/admin/social-content" element={<SocialContentManagement />} />
                  <Route path="/admin/ai/products/create" element={<AdminAIProductBuilder />} />
                  <Route path="/admin/voice-settings" element={<AdminVoiceSettings />} />
                  <Route path="/admin/imagination-products" element={<AdminImaginationProducts />} />
                  <Route path="/admin/email-templates" element={<AdminEmailTemplates />} />

                  {/* Imagination Station Routes */}
                  <Route
                    path="/imagination-station"
                    element={
                      <ImaginationErrorBoundary>
                        <ProtectedRoute>
                          <ImaginationStation />
                        </ProtectedRoute>
                      </ImaginationErrorBoundary>
                    }
                  />
                  <Route
                    path="/imagination-station/:id"
                    element={
                      <ImaginationErrorBoundary>
                        <ProtectedRoute>
                          <ImaginationStation />
                        </ProtectedRoute>
                      </ImaginationErrorBoundary>
                    }
                  />

                  {/* Manager Routes */}
                  <Route path="/manager/dashboard" element={<ManagerDashboard />} />

                  {/* Kiosk Routes */}
                  <Route path="/kiosk/:kioskId" element={<KioskRoute />} />

                  {/* Business Routes */}
                  <Route path="/wholesale" element={<WholesalePortal />} />

                  {/* Debug Route */}
                  <Route path="/debug/images" element={<ImageDebug />} />
                  </Routes>
                  </AppLayout>
                </Router>
                </SidebarProvider>
              </MrImagineNotificationProvider>
            </ToastProvider>
          </KioskAuthProvider>
        </CartProvider>
      </SupabaseAuthProvider>
    </ErrorBoundary>
  )
}

export default App

