import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { useNavigate } from 'react-router-dom'
import type { WholesaleVendor } from '../types'

interface VendorStorefrontConfig {
  id: string
  vendorId: string
  isPublic: boolean
  customDomain?: string
  customUrl: string
  seoTitle: string
  seoDescription: string
  theme: VendorStorefrontTheme
  featuredProducts: string[]
  categories: string[]
  socialLinks: {
    website?: string
    facebook?: string
    instagram?: string
    twitter?: string
    linkedin?: string
  }
  contactInfo: {
    showPhone: boolean
    showEmail: boolean
    showAddress: boolean
    customMessage?: string
  }
  analytics: {
    googleAnalyticsId?: string
    facebookPixelId?: string
  }
  lastUpdated: string
}

interface VendorStorefrontTheme {
  primaryColor: string
  secondaryColor: string
  backgroundColor: string
  headerStyle: 'minimal' | 'bold' | 'classic'
  layout: 'grid' | 'list' | 'masonry'
  showPricing: boolean
  showReviews: boolean
  customCSS?: string
}

const VendorStorefrontManager: React.FC = () => {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [vendor, setVendor] = useState<WholesaleVendor | null>(null)
  const [config, setConfig] = useState<VendorStorefrontConfig | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'general' | 'design' | 'seo' | 'analytics' | 'preview'>('general')
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  useEffect(() => {
    if (user?.role === 'vendor') {
      loadVendorStorefront()
    } else {
      setIsLoading(false)
    }
  }, [user])

  const loadVendorStorefront = async () => {
    setIsLoading(true)
    try {
      // Mock vendor data - in real app, this would fetch from API
      const mockVendor: WholesaleVendor = {
        id: 'vendor_1',
        userId: user!.id,
        companyName: 'Premium Apparel Co.',
        businessDescription: 'Leading manufacturer of high-quality custom apparel and promotional products.',
        logo: 'https://images.unsplash.com/photo-1560472354-b33ff0c44a43?w=200&h=200&fit=crop',
        coverImage: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1200&h=400&fit=crop',
        address: {
          company: 'Premium Apparel Co.',
          address1: '123 Manufacturing St',
          city: 'Los Angeles',
          state: 'CA',
          zip: '90210',
          country: 'US',
          phone: '(555) 123-4567',
          email: 'sales@premiumapparel.com'
        },
        contactInfo: {
          firstName: 'Sarah',
          lastName: 'Johnson',
          title: 'Sales Director',
          email: 'sarah@premiumapparel.com',
          phone: '(555) 123-4567'
        },
        categories: ['shirts', 'hoodies', 'dtf-transfers'],
        productCount: 150,
        minimumOrderValue: 500,
        leadTime: 7,
        shippingMethods: [],
        paymentMethods: ['Credit Card', 'Net 30', 'Wire Transfer'],
        certifications: ['ISO 9001', 'OEKO-TEX', 'WRAP'],
        rating: 4.8,
        reviewCount: 127,
        isVerified: true,
        isFeatured: true,
        status: 'active',
        joinedDate: '2023-01-15T00:00:00Z',
        lastActive: '2025-01-12T10:30:00Z'
      }

      const mockConfig: VendorStorefrontConfig = {
        id: 'storefront_1',
        vendorId: mockVendor.id,
        isPublic: true,
        customUrl: 'premium-apparel',
        seoTitle: 'Premium Apparel Co. - High-Quality Custom Apparel',
        seoDescription: 'Discover our premium collection of custom apparel and promotional products. Sustainable materials, fast turnaround, and exceptional quality.',
        theme: {
          primaryColor: '#8B5CF6',
          secondaryColor: '#06B6D4',
          backgroundColor: '#F8FAFC',
          headerStyle: 'bold',
          layout: 'grid',
          showPricing: true,
          showReviews: true,
          customCSS: ''
        },
        featuredProducts: ['wp_1', 'wp_2', 'wp_3'],
        categories: ['shirts', 'hoodies', 'dtf-transfers'],
        socialLinks: {
          website: 'https://premiumapparel.com',
          instagram: 'https://instagram.com/premiumapparel',
          linkedin: 'https://linkedin.com/company/premiumapparel'
        },
        contactInfo: {
          showPhone: true,
          showEmail: true,
          showAddress: false,
          customMessage: 'Ready to start your custom apparel project? Get in touch with our team for personalized service and competitive pricing.'
        },
        analytics: {
          googleAnalyticsId: ''
        },
        lastUpdated: '2025-01-10T00:00:00Z'
      }

      setVendor(mockVendor)
      setConfig(mockConfig)
    } catch (error) {
      console.error('Error loading vendor storefront:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleConfigChange = (section: string, field: string, value: any) => {
    if (!config) return

    const newConfig = { ...config }
    
    if (section === 'root') {
      (newConfig as any)[field] = value
    } else {
      (newConfig as any)[section] = {
        ...(newConfig as any)[section],
        [field]: value
      }
    }

    setConfig(newConfig)
    setHasChanges(true)
  }

  const handleSave = async () => {
    if (!config) return

    setIsSaving(true)
    try {
      // Mock save - in real app, this would save to API
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      setHasChanges(false)
      alert('Storefront configuration saved successfully!')
    } catch (error) {
      console.error('Error saving configuration:', error)
      alert('Error saving configuration. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  const generateStorefrontUrl = () => {
    if (!config) return ''
    const baseUrl = window.location.origin
    return config.customDomain || `${baseUrl}/vendor/${config.customUrl}`
  }

  const checkUrlAvailability = async (url: string) => {
    // Mock URL availability check
    const reservedUrls = ['admin', 'api', 'www', 'app', 'premium-apparel']
    return !reservedUrls.includes(url.toLowerCase())
  }

  if (!user || user.role !== 'vendor') {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
          <p className="text-yellow-800">
            Storefront management is available to vendors only.
            <button 
              onClick={() => navigate('/vendor-application')}
              className="ml-2 text-purple-600 hover:text-purple-700 font-medium"
            >
              Apply to become a vendor →
            </button>
          </p>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
        </div>
      </div>
    )
  }

  if (!vendor || !config) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Storefront Not Found</h1>
          <p className="text-gray-600 mb-6">We couldn't find your vendor storefront. Please contact support.</p>
        </div>
      </div>
    )
  }

  const tabs = [
    { id: 'general', label: 'General Settings', icon: '⚙️' },
    { id: 'design', label: 'Design & Branding', icon: '🎨' },
    { id: 'seo', label: 'SEO & Marketing', icon: '📈' },
    { id: 'analytics', label: 'Analytics', icon: '📊' },
    { id: 'preview', label: 'Preview', icon: '👁️' }
  ]

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Storefront Manager</h1>
            <p className="text-gray-600">Customize your public vendor storefront</p>
          </div>
          
          <div className="flex items-center space-x-4">
            <a
              href={generateStorefrontUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary"
            >
              View Live Site →
            </a>
            <button
              onClick={handleSave}
              disabled={!hasChanges || isSaving}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
        
        {/* Status Bar */}
        <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <svg className="w-5 h-5 text-green-600 mr-2" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
              </svg>
              <span className="text-green-900 font-medium">
                Your storefront is {config.isPublic ? 'live' : 'private'}
              </span>
            </div>
            <div className="text-sm text-green-700">
              URL: {generateStorefrontUrl()}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-8">
        <nav className="-mb-px flex space-x-8">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center ${
                activeTab === tab.id
                  ? 'border-purple-500 text-purple-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <span className="mr-2">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          {activeTab === 'general' && (
            <GeneralSettings 
              config={config} 
              vendor={vendor}
              onChange={handleConfigChange}
              onUrlCheck={checkUrlAvailability}
            />
          )}

          {activeTab === 'design' && (
            <DesignSettings 
              config={config} 
              onChange={handleConfigChange}
            />
          )}

          {activeTab === 'seo' && (
            <SEOSettings 
              config={config} 
              onChange={handleConfigChange}
            />
          )}

          {activeTab === 'analytics' && (
            <AnalyticsSettings 
              config={config} 
              onChange={handleConfigChange}
            />
          )}

          {activeTab === 'preview' && (
            <PreviewSection 
              config={config}
              vendor={vendor}
            />
          )}
        </div>

        {/* Preview Sidebar */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-lg shadow p-6 sticky top-8">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Quick Preview</h3>
            
            {/* Mini Preview */}
            <div className="border rounded-lg overflow-hidden mb-4">
              <div 
                className="h-20 flex items-center justify-center text-white text-sm font-medium"
                style={{ backgroundColor: config.theme.primaryColor }}
              >
                {vendor.companyName}
              </div>
              <div className="p-3 bg-gray-50">
                <div className="flex items-center justify-between text-xs text-gray-600 mb-2">
                  <span>Products</span>
                  <span>{vendor.productCount}</span>
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {[1, 2, 3, 4].map(i => (
                    <div key={i} className="aspect-square bg-gray-200 rounded"></div>
                  ))}
                </div>
              </div>
            </div>

            {/* Quick Stats */}
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Storefront Status:</span>
                <span className={config.isPublic ? 'text-green-600' : 'text-yellow-600'}>
                  {config.isPublic ? 'Live' : 'Private'}
                </span>
              </div>
              
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Custom URL:</span>
                <span className="text-purple-600">{config.customUrl}</span>
              </div>
              
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Theme:</span>
                <span className="capitalize">{config.theme.headerStyle}</span>
              </div>
              
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Layout:</span>
                <span className="capitalize">{config.theme.layout}</span>
              </div>
            </div>

            {/* Actions */}
            <div className="mt-6 space-y-2">
              <button
                onClick={() => window.open(generateStorefrontUrl(), '_blank')}
                className="w-full btn-secondary text-sm"
              >
                Open in New Tab
              </button>
              <button
                onClick={() => setActiveTab('preview')}
                className="w-full btn-primary text-sm"
              >
                Full Preview
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// General Settings Component
const GeneralSettings: React.FC<{
  config: VendorStorefrontConfig
  vendor: WholesaleVendor
  onChange: (section: string, field: string, value: any) => void
  onUrlCheck: (url: string) => Promise<boolean>
}> = ({ config, onChange, onUrlCheck }) => {
  const [urlAvailable, setUrlAvailable] = useState<boolean | null>(null)

  const handleUrlChange = async (url: string) => {
    onChange('root', 'customUrl', url)
    
    if (url) {
      const available = await onUrlCheck(url)
      setUrlAvailable(available)
    }
  }

  return (
    <div className="space-y-8">
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-6">Basic Information</h3>
        
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Storefront Status
            </label>
            <div className="flex items-center">
              <input
                type="checkbox"
                checked={config.isPublic}
                onChange={(e) => onChange('root', 'isPublic', e.target.checked)}
                className="mr-2"
              />
              <span className="text-sm text-gray-600">
                Make storefront publicly accessible
              </span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Custom URL
            </label>
            <div className="flex">
              <span className="inline-flex items-center px-3 py-2 border border-r-0 border-gray-300 bg-gray-50 text-gray-500 text-sm rounded-l-md">
                imagine-this-printed.com/vendor/
              </span>
              <input
                type="text"
                value={config.customUrl}
                onChange={(e) => handleUrlChange(e.target.value)}
                className="flex-1 form-input rounded-l-none"
                placeholder="your-company-name"
              />
            </div>
            {urlAvailable === false && (
              <p className="mt-1 text-sm text-red-600">This URL is not available</p>
            )}
            {urlAvailable === true && (
              <p className="mt-1 text-sm text-green-600">This URL is available</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Custom Domain (Optional)
            </label>
            <input
              type="text"
              value={config.customDomain || ''}
              onChange={(e) => onChange('root', 'customDomain', e.target.value)}
              className="form-input w-full"
              placeholder="shop.yourdomain.com"
            />
            <p className="mt-1 text-sm text-gray-500">
              Contact support to set up a custom domain
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-6">Contact Information</h3>
        
        <div className="space-y-4">
          <div className="flex items-center">
            <input
              type="checkbox"
              checked={config.contactInfo.showPhone}
              onChange={(e) => onChange('contactInfo', 'showPhone', e.target.checked)}
              className="mr-2"
            />
            <span className="text-sm text-gray-600">Show phone number</span>
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              checked={config.contactInfo.showEmail}
              onChange={(e) => onChange('contactInfo', 'showEmail', e.target.checked)}
              className="mr-2"
            />
            <span className="text-sm text-gray-600">Show email address</span>
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              checked={config.contactInfo.showAddress}
              onChange={(e) => onChange('contactInfo', 'showAddress', e.target.checked)}
              className="mr-2"
            />
            <span className="text-sm text-gray-600">Show business address</span>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Custom Contact Message
            </label>
            <textarea
              value={config.contactInfo.customMessage || ''}
              onChange={(e) => onChange('contactInfo', 'customMessage', e.target.value)}
              rows={3}
              className="form-textarea w-full"
              placeholder="Add a personalized message for potential customers..."
            />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-6">Social Links</h3>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Website</label>
            <input
              type="url"
              value={config.socialLinks.website || ''}
              onChange={(e) => onChange('socialLinks', 'website', e.target.value)}
              className="form-input w-full"
              placeholder="https://yourwebsite.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Instagram</label>
            <input
              type="url"
              value={config.socialLinks.instagram || ''}
              onChange={(e) => onChange('socialLinks', 'instagram', e.target.value)}
              className="form-input w-full"
              placeholder="https://instagram.com/yourcompany"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">LinkedIn</label>
            <input
              type="url"
              value={config.socialLinks.linkedin || ''}
              onChange={(e) => onChange('socialLinks', 'linkedin', e.target.value)}
              className="form-input w-full"
              placeholder="https://linkedin.com/company/yourcompany"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// Design Settings Component
const DesignSettings: React.FC<{
  config: VendorStorefrontConfig
  onChange: (section: string, field: string, value: any) => void
}> = ({ config, onChange }) => {
  return (
    <div className="space-y-8">
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-6">Color Scheme</h3>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Primary Color
            </label>
            <div className="flex items-center space-x-3">
              <input
                type="color"
                value={config.theme.primaryColor}
                onChange={(e) => onChange('theme', 'primaryColor', e.target.value)}
                className="w-12 h-12 border border-gray-300 rounded-md"
              />
              <input
                type="text"
                value={config.theme.primaryColor}
                onChange={(e) => onChange('theme', 'primaryColor', e.target.value)}
                className="form-input flex-1"
                placeholder="#8B5CF6"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Secondary Color
            </label>
            <div className="flex items-center space-x-3">
              <input
                type="color"
                value={config.theme.secondaryColor}
                onChange={(e) => onChange('theme', 'secondaryColor', e.target.value)}
                className="w-12 h-12 border border-gray-300 rounded-md"
              />
              <input
                type="text"
                value={config.theme.secondaryColor}
                onChange={(e) => onChange('theme', 'secondaryColor', e.target.value)}
                className="form-input flex-1"
                placeholder="#06B6D4"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Background Color
            </label>
            <div className="flex items-center space-x-3">
              <input
                type="color"
                value={config.theme.backgroundColor}
                onChange={(e) => onChange('theme', 'backgroundColor', e.target.value)}
                className="w-12 h-12 border border-gray-300 rounded-md"
              />
              <input
                type="text"
                value={config.theme.backgroundColor}
                onChange={(e) => onChange('theme', 'backgroundColor', e.target.value)}
                className="form-input flex-1"
                placeholder="#F8FAFC"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-6">Layout Options</h3>
        
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Header Style
            </label>
            <div className="grid grid-cols-3 gap-3">
              {[
                { id: 'minimal', label: 'Minimal', preview: 'Clean & simple' },
                { id: 'bold', label: 'Bold', preview: 'Colorful gradient' },
                { id: 'classic', label: 'Classic', preview: 'Professional dark' }
              ].map((style) => (
                <label key={style.id} className="cursor-pointer">
                  <input
                    type="radio"
                    name="headerStyle"
                    value={style.id}
                    checked={config.theme.headerStyle === style.id}
                    onChange={(e) => onChange('theme', 'headerStyle', e.target.value)}
                    className="sr-only"
                  />
                  <div className={`border-2 rounded-lg p-3 text-center ${
                    config.theme.headerStyle === style.id 
                      ? 'border-purple-500 bg-purple-50' 
                      : 'border-gray-200 hover:border-gray-300'
                  }`}>
                    <div className="font-medium text-sm">{style.label}</div>
                    <div className="text-xs text-gray-500 mt-1">{style.preview}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Product Layout
            </label>
            <div className="grid grid-cols-3 gap-3">
              {[
                { id: 'grid', label: 'Grid', preview: 'Card layout' },
                { id: 'list', label: 'List', preview: 'Horizontal layout' },
                { id: 'masonry', label: 'Masonry', preview: 'Pinterest style' }
              ].map((layout) => (
                <label key={layout.id} className="cursor-pointer">
                  <input
                    type="radio"
                    name="layout"
                    value={layout.id}
                    checked={config.theme.layout === layout.id}
                    onChange={(e) => onChange('theme', 'layout', e.target.value)}
                    className="sr-only"
                  />
                  <div className={`border-2 rounded-lg p-3 text-center ${
                    config.theme.layout === layout.id 
                      ? 'border-purple-500 bg-purple-50' 
                      : 'border-gray-200 hover:border-gray-300'
                  }`}>
                    <div className="font-medium text-sm">{layout.label}</div>
                    <div className="text-xs text-gray-500 mt-1">{layout.preview}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-6">Display Options</h3>
        
        <div className="space-y-4">
          <div className="flex items-center">
            <input
              type="checkbox"
              checked={config.theme.showPricing}
              onChange={(e) => onChange('theme', 'showPricing', e.target.checked)}
              className="mr-2"
            />
            <span className="text-sm text-gray-600">Show product pricing</span>
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              checked={config.theme.showReviews}
              onChange={(e) => onChange('theme', 'showReviews', e.target.checked)}
              className="mr-2"
            />
            <span className="text-sm text-gray-600">Show customer reviews</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// Placeholder components for other tabs
const SEOSettings: React.FC<{
  config: VendorStorefrontConfig
  onChange: (section: string, field: string, value: any) => void
}> = ({ config, onChange }) => (
  <div className="bg-white rounded-lg shadow p-6">
    <h3 className="text-lg font-medium text-gray-900 mb-6">SEO & Marketing</h3>
    
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">SEO Title</label>
        <input
          type="text"
          value={config.seoTitle}
          onChange={(e) => onChange('root', 'seoTitle', e.target.value)}
          className="form-input w-full"
          maxLength={60}
        />
        <p className="text-xs text-gray-500 mt-1">{config.seoTitle.length}/60 characters</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">SEO Description</label>
        <textarea
          value={config.seoDescription}
          onChange={(e) => onChange('root', 'seoDescription', e.target.value)}
          rows={3}
          className="form-textarea w-full"
          maxLength={160}
        />
        <p className="text-xs text-gray-500 mt-1">{config.seoDescription.length}/160 characters</p>
      </div>
    </div>
  </div>
)

const AnalyticsSettings: React.FC<{
  config: VendorStorefrontConfig
  onChange: (section: string, field: string, value: any) => void
}> = ({ config, onChange }) => (
  <div className="bg-white rounded-lg shadow p-6">
    <h3 className="text-lg font-medium text-gray-900 mb-6">Analytics Integration</h3>
    
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Google Analytics ID</label>
        <input
          type="text"
          value={config.analytics.googleAnalyticsId || ''}
          onChange={(e) => onChange('analytics', 'googleAnalyticsId', e.target.value)}
          className="form-input w-full"
          placeholder="GA-XXXXXXX-X"
        />
      </div>
    </div>
  </div>
)

const PreviewSection: React.FC<{
  config: VendorStorefrontConfig
  vendor: WholesaleVendor
}> = ({ config }) => (
  <div className="bg-white rounded-lg shadow p-6">
    <h3 className="text-lg font-medium text-gray-900 mb-6">Storefront Preview</h3>
    <iframe
      src={`/vendor/${config.customUrl}`}
      className="w-full h-96 border rounded-lg"
      title="Storefront Preview"
    />
  </div>
)

export default VendorStorefrontManager