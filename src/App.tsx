import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { SupabaseAuthProvider } from './context/SupabaseAuthContext'
import { CartProvider } from './context/CartContext'
import { KioskAuthProvider } from './context/KioskAuthContext'
import ErrorBoundary from './components/ErrorBoundary'
// import './utils/debug' // Auto-run debug utilities
// import './utils/connectivity-test' // Additional connectivity tests
// import './utils/env-check' // Environment diagnostic
import Navbar from './components/Navbar'
import { Header } from './components/Header'
import { Footer } from './components/Footer'
import KioskRoute from './components/KioskRoute'
import ProtectedRoute from './components/ProtectedRoute'
// import ChatBotWidget from './components/ChatBotWidget' // Replaced with Mr. Imagine
import { MrImagineChatWidget } from './components/MrImagineChatWidget'
import FloatingCart from './components/FloatingCart'
import Home from './pages/Home'
import Login from './pages/Login'
import Signup from './pages/Signup'
import AuthCallback from './pages/AuthCallback'
import AuthError from './pages/AuthError'
import ProductCatalog from './pages/ProductCatalog'
import ProductPage from './pages/ProductPage'
import ProductDesigner from './pages/ProductDesigner'
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
import { UserProductCreator } from './pages/UserProductCreator'
import { AdminVoiceSettings } from './pages/admin/VoiceSettings'

function App() {
  return (
    <ErrorBoundary>
      <SupabaseAuthProvider>
        <CartProvider>
          <KioskAuthProvider>
            <Router>
              <div className="min-h-screen bg-bg text-text">
                <Header />
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
                  <Route path="/create-design" element={<ProtectedRoute><UserProductCreator /></ProtectedRoute>} />
                  <Route path="/designer" element={<ProtectedRoute><ProductDesigner /></ProtectedRoute>} />
                  <Route path="/cart" element={<Cart />} />
                  <Route path="/checkout" element={<Checkout />} />
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
                  <Route path="/community" element={<ProtectedRoute><Community /></ProtectedRoute>} />

                  {/* Account & Profile Routes */}
                  <Route path="/account/profile" element={<UserProfile />} />
                  <Route path="/account/profile/edit" element={<ProfileEdit />} />
                  <Route path="/profile/:username" element={<UserProfile />} />
                  <Route path="/account/messages" element={<CustomerMessages />} />
                  <Route path="/account/media" element={<ProtectedRoute><UserMediaGallery /></ProtectedRoute>} />

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

                  {/* Manager Routes */}
                  <Route path="/manager/dashboard" element={<ManagerDashboard />} />

                  {/* Kiosk Routes */}
                  <Route path="/kiosk/:kioskId" element={<KioskRoute />} />

                  {/* Business Routes */}
                  <Route path="/wholesale" element={<WholesalePortal />} />

                  {/* Debug Route */}
                  <Route path="/debug/images" element={<ImageDebug />} />
                </Routes>

                {/* Mr. Imagine Chat Widget - appears on all pages */}
                <MrImagineChatWidget />

                {/* Floating Cart - appears on all pages */}
                <FloatingCart />

                {/* Footer - appears on all pages */}
                <Footer />
              </div>
            </Router>
          </KioskAuthProvider>
        </CartProvider>
      </SupabaseAuthProvider>
    </ErrorBoundary>
  )
}

export default App

