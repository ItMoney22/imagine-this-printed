import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useEffect, lazy, Suspense } from 'react'
import { SupabaseAuthProvider } from './context/SupabaseAuthContext'
import { CartProvider } from './context/CartContext'
import { KioskAuthProvider } from './context/KioskAuthContext'
import { ToastProvider } from './context/ToastContext'
import { SidebarProvider, useSidebar } from './context/SidebarContext'
import ErrorBoundary from './components/ErrorBoundary'
import { Sidebar, MobileMenuButton } from './components/Sidebar'
import { Footer } from './components/Footer'
import KioskRoute from './components/KioskRoute'
import ProtectedRoute from './components/ProtectedRoute'
import RoleRoute from './components/RoleRoute'
import { MrImagineChatWidget } from './components/MrImagineChatWidget'
import { MrImagineCartNotification } from './components/mr-imagine/MrImagineCartNotification'
import FloatingCart from './components/FloatingCart'
import WatchtowerTaskButton from './components/WatchtowerTaskButton'
import { MrImagineNotificationProvider } from './components/MrImagineNotification'
import { ToastContainer } from './components/ToastContainer'
import { ImaginationErrorBoundary } from './components/imagination'
import CookieConsent from './components/CookieConsent'

// Eagerly-loaded pages: public/landing routes that should be on the first
// paint (the rest is below as React.lazy chunks). Auth + catalog + cart are
// hot paths; legal pages are tiny static markup.
import Home from './pages/Home'
import Login from './pages/Login'
import Signup from './pages/Signup'
import AuthCallback from './pages/AuthCallback'
import AuthError from './pages/AuthError'
import ProductCatalog from './pages/ProductCatalog'
import ProductPage from './pages/ProductPage'
import Cart from './pages/Cart'
import OrderSuccess from './pages/OrderSuccess'
import Contact from './pages/Contact'
import Referrals from './pages/Referrals'
import UserProfile from './pages/UserProfile'
import PrivacyPolicy from './pages/PrivacyPolicy'
import TermsOfService from './pages/TermsOfService'
import ShippingPolicy from './pages/ShippingPolicy'
import ReturnsPolicy from './pages/ReturnsPolicy'

// Lazy-loaded pages: heavy/admin/auth-gated routes that don't need to be in
// the initial bundle. Each becomes its own chunk; React.lazy needs `default`
// exports, so named exports are unwrapped in the dynamic import.
const Checkout = lazy(() => import('./pages/Checkout'))
const FoundersDashboard = lazy(() => import('./pages/FoundersDashboard'))
const VendorDashboard = lazy(() => import('./pages/VendorDashboard'))
const ModelGallery = lazy(() => import('./pages/ModelGallery'))
const Wallet = lazy(() => import('./pages/Wallet'))
const CRM = lazy(() => import('./pages/CRM'))
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'))
const AdminEmail = lazy(() => import('./pages/AdminEmail'))
const AdminToyLab = lazy(() => import('./pages/AdminToyLab'))
const ToyCreator = lazy(() => import('./pages/ToyCreator'))
const MetalArtStudio = lazy(() => import('./pages/MetalArtStudio'))
const MarketingTools = lazy(() => import('./pages/MarketingTools'))
const OrderManagement = lazy(() => import('./pages/OrderManagement'))
const ProfileEdit = lazy(() => import('./pages/ProfileEdit'))
const CustomerMessages = lazy(() => import('./pages/CustomerMessages'))
const VendorMessages = lazy(() => import('./pages/VendorMessages'))
const VendorPayouts = lazy(() => import('./pages/VendorPayouts'))
const FounderEarningsPage = lazy(() => import('./pages/FounderEarnings'))
const AdminControlPanel = lazy(() => import('./pages/AdminControlPanel'))
const AdminEmailTemplates = lazy(() => import('./pages/AdminEmailTemplates'))
const AdminPanel = lazy(() => import('./pages/AdminPanel'))
const WholesalePortal = lazy(() => import('./pages/WholesalePortal'))
const VendorStorefront = lazy(() => import('./pages/VendorStorefront'))
const ManagerDashboard = lazy(() => import('./pages/ManagerDashboard'))
const AdminCostOverride = lazy(() => import('./pages/AdminCostOverride'))
const KioskManagement = lazy(() => import('./pages/KioskManagement'))
const KioskAnalytics = lazy(() => import('./pages/KioskAnalytics'))
const Community = lazy(() => import('./pages/Community'))
const ImageDebug = lazy(() => import('./pages/ImageDebug'))
const AdminAIProductBuilder = lazy(() => import('./pages/AdminAIProductBuilder'))
const SocialContentManagement = lazy(() => import('./pages/SocialContentManagement'))
const UserMediaGallery = lazy(() => import('./pages/UserMediaGallery'))
const UserDesignDashboard = lazy(() => import('./pages/UserDesignDashboard'))
const MyOrders = lazy(() => import('./pages/MyOrders'))
const OrderStatus = lazy(() => import('./pages/OrderStatus'))
const AdminVoiceSettings = lazy(() => import('./pages/admin/VoiceSettings').then(m => ({ default: m.AdminVoiceSettings })))
const AdminImaginationProducts = lazy(() => import('./pages/admin/ImaginationProducts'))
const ImaginationStation = lazy(() => import('./pages/ImaginationStation'))
const ToyAR = lazy(() => import('./pages/ToyAR'))
const BecomeCreator = lazy(() => import('./pages/BecomeCreator'))
const CreatorStudio = lazy(() => import('./pages/CreatorStudio'))

// Routes that should hide the sidebar for full-screen experience
const FULL_SCREEN_ROUTES = ['/imagination-station', '/order-success', '/kiosk', '/ar/']

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
      <FloatingCart />
      <WatchtowerTaskButton />
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
                <Suspense fallback={
                  <div className="min-h-[40vh] flex items-center justify-center">
                    <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  </div>
                }>
                <Routes>
                  <Route path="/" element={<Home />} />
                  <Route path="/login" element={<Login />} />
                  <Route path="/signup" element={<Signup />} />
                  <Route path="/auth/callback" element={<AuthCallback />} />
                  <Route path="/auth/error" element={<AuthError />} />
                  <Route path="/auth/reset-password" element={<AuthCallback />} />
                  <Route path="/catalog" element={<ProductCatalog />} />
                  {/* Retired seasonal pages (July 4th / World Cup) — send old links to the catalog */}
                  <Route path="/america-250" element={<Navigate to="/catalog" replace />} />
                  <Route path="/july4" element={<Navigate to="/catalog" replace />} />
                  <Route path="/world-cup" element={<Navigate to="/catalog" replace />} />
                  <Route path="/worldcup" element={<Navigate to="/catalog" replace />} />
                  <Route path="/catalog/:category" element={<ProductCatalog />} />
                  <Route path="/product/:id" element={<ProductPage />} />
                  {/* Redirect old design routes to Imagination Station */}
                  <Route path="/create-design" element={<Navigate to="/imagination-station" replace />} />
                  <Route path="/designer" element={<Navigate to="/imagination-station" replace />} />
                  <Route path="/cart" element={<Cart />} />
                  <Route path="/checkout" element={<Checkout />} />
                  <Route path="/order-success" element={<OrderSuccess />} />
                  {/* PUBLIC — tokenized link from order emails; guests have no login */}
                  <Route path="/order-status/:orderId" element={<OrderStatus />} />
                  <Route path="/founders" element={<FoundersDashboard />} />
                  <Route path="/vendor" element={<VendorDashboard />} />
                  <Route path="/models" element={<ProtectedRoute><ModelGallery /></ProtectedRoute>} />
                  <Route path="/3d-models" element={<ProtectedRoute><ModelGallery /></ProtectedRoute>} />
                  <Route path="/toy-creator" element={<ProtectedRoute><ToyCreator /></ProtectedRoute>} />
                  <Route path="/metal-art" element={<ProtectedRoute><MetalArtStudio /></ProtectedRoute>} />
                  {/* PUBLIC — opened by scanning the NFC tag in a printed figurine */}
                  <Route path="/ar/:modelId" element={<ToyAR />} />
                  <Route path="/wallet" element={<Wallet />} />
                  {/* Unprefixed aliases of the admin pages below — same
                      components, so they carry the same role gate. */}
                  <Route path="/crm" element={<RoleRoute allowedRoles={['admin', 'manager']}><CRM /></RoleRoute>} />
                  <Route path="/admin" element={<RoleRoute allowedRoles={['admin']}><AdminDashboard /></RoleRoute>} />
                  <Route path="/marketing" element={<RoleRoute allowedRoles={['admin', 'manager']}><MarketingTools /></RoleRoute>} />
                  <Route path="/orders" element={<RoleRoute allowedRoles={['admin', 'manager', 'founder']}><OrderManagement /></RoleRoute>} />
                  <Route path="/referrals" element={<Referrals />} />
                  <Route path="/contact" element={<Contact />} />
                  <Route path="/community" element={<ProtectedRoute><Community /></ProtectedRoute>} />

                  {/* Legal Pages */}
                  <Route path="/privacy" element={<PrivacyPolicy />} />
                  <Route path="/terms" element={<TermsOfService />} />
                  <Route path="/shipping" element={<ShippingPolicy />} />
                  <Route path="/returns" element={<ReturnsPolicy />} />

                  {/* Account & Profile Routes.
                      `/account/*` paths are user-owned data and need auth;
                      `/profile/:username` is public profile viewing (anyone
                      can look up a creator), so intentionally NOT wrapped. */}
                  <Route path="/account/profile" element={<ProtectedRoute><UserProfile /></ProtectedRoute>} />
                  <Route path="/account/profile/edit" element={<ProtectedRoute><ProfileEdit /></ProtectedRoute>} />
                  <Route path="/profile/:username" element={<UserProfile />} />
                  <Route path="/account/messages" element={<ProtectedRoute><CustomerMessages /></ProtectedRoute>} />
                  <Route path="/account/media" element={<ProtectedRoute><UserMediaGallery /></ProtectedRoute>} />
                  <Route path="/account/designs" element={<ProtectedRoute><UserDesignDashboard /></ProtectedRoute>} />
                  <Route path="/my-designs" element={<ProtectedRoute><UserDesignDashboard /></ProtectedRoute>} />
                  <Route path="/account/orders" element={<ProtectedRoute><MyOrders /></ProtectedRoute>} />

                  {/* Creator Routes — instant opt-in program; the studio page
                      itself redirects non-creators to /become-creator */}
                  <Route path="/become-creator" element={<ProtectedRoute><BecomeCreator /></ProtectedRoute>} />
                  <Route path="/creator/studio" element={<ProtectedRoute><CreatorStudio /></ProtectedRoute>} />

                  {/* Vendor Routes */}
                  <Route path="/vendor/dashboard" element={<VendorDashboard />} />
                  <Route path="/vendor/messages" element={<VendorMessages />} />
                  <Route path="/vendor/payouts" element={<VendorPayouts />} />
                  <Route path="/vendor/storefront/:vendorId" element={<VendorStorefront />} />

                  {/* Founder Routes */}
                  <Route path="/founder/dashboard" element={<FoundersDashboard />} />
                  <Route path="/founder/earnings" element={<FounderEarningsPage />} />

                  {/* Admin Routes.
                      Every one is wrapped in RoleRoute so the lazy admin chunk
                      is never fetched by an unauthorized visitor. The role sets
                      mirror the checks that already live inside each page.
                      NOTE: this is a client-side guard — defense in depth, not
                      authorization. The matching /admin API routes must enforce
                      the same roles server-side. */}
                  <Route path="/admin/dashboard" element={<RoleRoute allowedRoles={['admin']}><AdminDashboard /></RoleRoute>} />
                  <Route path="/admin/email" element={<RoleRoute allowedRoles={['admin']}><AdminEmail /></RoleRoute>} />
                  <Route path="/admin/toys" element={<RoleRoute allowedRoles={['admin']}><AdminToyLab /></RoleRoute>} />
                  <Route path="/admin/control-panel" element={<RoleRoute allowedRoles={['admin', 'founder']}><AdminControlPanel /></RoleRoute>} />
                  <Route path="/admin-panel" element={<RoleRoute allowedRoles={['admin']}><AdminPanel /></RoleRoute>} />
                  <Route path="/admin/orders" element={<RoleRoute allowedRoles={['admin', 'manager', 'founder']}><OrderManagement /></RoleRoute>} />
                  <Route path="/admin/crm" element={<RoleRoute allowedRoles={['admin', 'manager']}><CRM /></RoleRoute>} />
                  <Route path="/admin/marketing" element={<RoleRoute allowedRoles={['admin', 'manager']}><MarketingTools /></RoleRoute>} />
                  {/* Removed: /admin/products route - use AdminDashboard Products tab instead */}
                  <Route path="/admin/cost-override" element={<RoleRoute allowedRoles={['admin', 'founder']}><AdminCostOverride /></RoleRoute>} />
                  <Route path="/admin/kiosks" element={<RoleRoute allowedRoles={['admin', 'founder']}><KioskManagement /></RoleRoute>} />
                  <Route path="/admin/kiosk-analytics" element={<RoleRoute allowedRoles={['admin', 'founder', 'vendor']}><KioskAnalytics /></RoleRoute>} />
                  <Route path="/admin/social-content" element={<RoleRoute allowedRoles={['admin', 'founder', 'manager']}><SocialContentManagement /></RoleRoute>} />
                  <Route path="/admin/ai/products/create" element={<RoleRoute allowedRoles={['admin', 'manager']}><AdminAIProductBuilder /></RoleRoute>} />
                  <Route path="/admin/voice-settings" element={<RoleRoute allowedRoles={['admin']}><AdminVoiceSettings /></RoleRoute>} />
                  <Route path="/admin/imagination-products" element={<RoleRoute allowedRoles={['admin']}><AdminImaginationProducts /></RoleRoute>} />
                  <Route path="/admin/email-templates" element={<RoleRoute allowedRoles={['admin', 'manager']}><AdminEmailTemplates /></RoleRoute>} />

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
                  <Route path="/wholesale" element={<ProtectedRoute><WholesalePortal /></ProtectedRoute>} />

                  {/* Debug Route */}
                  <Route path="/debug/images" element={<ImageDebug />} />

                  {/* 404 Catch-all */}
                  <Route path="*" element={
                    <div className="min-h-screen bg-bg flex items-center justify-center">
                      <div className="text-center px-4">
                        <h1 className="text-6xl font-bold text-primary mb-4">404</h1>
                        <p className="text-xl text-text mb-2">Page Not Found</p>
                        <p className="text-muted mb-8">The page you're looking for doesn't exist or has been moved.</p>
                        <a href="/" className="inline-block px-6 py-3 bg-primary text-bg font-medium rounded-lg hover:bg-primary/90 transition-colors">
                          Go Home
                        </a>
                      </div>
                    </div>
                  } />
                  </Routes>
                  </Suspense>
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

