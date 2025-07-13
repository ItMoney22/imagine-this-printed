import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { useNavigate } from 'react-router-dom'
import type { WholesaleVendor } from '../types'

const VendorDirectory: React.FC = () => {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [vendors, setVendors] = useState<WholesaleVendor[]>([])
  const [filteredVendors, setFilteredVendors] = useState<WholesaleVendor[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedFilters, setSelectedFilters] = useState({
    category: 'all',
    location: 'all',
    certification: 'all',
    minimumOrder: 'all',
    sort: 'rating'
  })
  const [searchQuery, setSearchQuery] = useState('')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')

  useEffect(() => {
    loadVendors()
  }, [])

  useEffect(() => {
    filterVendors()
  }, [vendors, selectedFilters, searchQuery])

  const loadVendors = async () => {
    setIsLoading(true)
    try {
      // Mock vendor data - in real app, this would fetch from API
      const mockVendors: WholesaleVendor[] = [
        {
          id: 'vendor_1',
          userId: 'user_vendor_1',
          companyName: 'Premium Apparel Co.',
          businessDescription: 'Leading manufacturer of high-quality custom apparel and promotional products.',
          logo: 'https://images.unsplash.com/photo-1560472354-b33ff0c44a43?w=200&h=200&fit=crop',
          coverImage: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=800&h=300&fit=crop',
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
          shippingMethods: [
            { name: 'Standard', description: 'Standard shipping', estimatedDays: 5, cost: 15.00 },
            { name: 'Express', description: 'Express shipping', estimatedDays: 2, cost: 35.00, freeShippingThreshold: 1000 }
          ],
          paymentMethods: ['Credit Card', 'Net 30', 'Wire Transfer'],
          certifications: ['ISO 9001', 'OEKO-TEX', 'WRAP'],
          rating: 4.8,
          reviewCount: 127,
          isVerified: true,
          isFeatured: true,
          status: 'active',
          joinedDate: '2023-01-15T00:00:00Z',
          lastActive: '2025-01-12T10:30:00Z'
        },
        {
          id: 'vendor_2',
          userId: 'user_vendor_2',
          companyName: 'Digital Transfer Solutions',
          businessDescription: 'Specializing in high-quality DTF transfers and custom printing solutions.',
          logo: 'https://images.unsplash.com/photo-1560472354-b33ff0c44a43?w=200&h=200&fit=crop',
          address: {
            company: 'Digital Transfer Solutions',
            address1: '456 Print Ave',
            city: 'Miami',
            state: 'FL',
            zip: '33101',
            country: 'US',
            phone: '(555) 987-6543',
            email: 'info@digitaltransfer.com'
          },
          contactInfo: {
            firstName: 'Mike',
            lastName: 'Rodriguez',
            title: 'Business Development',
            email: 'mike@digitaltransfer.com',
            phone: '(555) 987-6543'
          },
          categories: ['dtf-transfers'],
          productCount: 85,
          minimumOrderValue: 250,
          leadTime: 3,
          shippingMethods: [
            { name: 'Standard', description: 'Standard shipping', estimatedDays: 3, cost: 12.00 },
            { name: 'Rush', description: 'Rush production + shipping', estimatedDays: 1, cost: 50.00 }
          ],
          paymentMethods: ['Credit Card', 'PayPal', 'Net 15'],
          certifications: ['GREENGUARD Gold'],
          rating: 4.6,
          reviewCount: 89,
          isVerified: true,
          isFeatured: false,
          status: 'active',
          joinedDate: '2023-03-20T00:00:00Z',
          lastActive: '2025-01-11T15:45:00Z'
        },
        {
          id: 'vendor_3',
          userId: 'user_vendor_3',
          companyName: 'Eco-Friendly Goods Inc.',
          businessDescription: 'Sustainable and eco-friendly promotional products and apparel.',
          logo: 'https://images.unsplash.com/photo-1560472354-b33ff0c44a43?w=200&h=200&fit=crop',
          address: {
            company: 'Eco-Friendly Goods Inc.',
            address1: '789 Green Way',
            city: 'Portland',
            state: 'OR',
            zip: '97201',
            country: 'US',
            phone: '(555) 456-7890',
            email: 'hello@ecofriendlygoods.com'
          },
          contactInfo: {
            firstName: 'Emma',
            lastName: 'Green',
            title: 'Sustainability Director',
            email: 'emma@ecofriendlygoods.com',
            phone: '(555) 456-7890'
          },
          categories: ['shirts', 'tumblers', '3d-models'],
          productCount: 95,
          minimumOrderValue: 300,
          leadTime: 10,
          shippingMethods: [
            { name: 'Carbon Neutral', description: 'Eco-friendly shipping', estimatedDays: 7, cost: 18.00, freeShippingThreshold: 500 }
          ],
          paymentMethods: ['Credit Card', 'Net 30'],
          certifications: ['B-Corp', 'Carbon Neutral', 'Fair Trade'],
          rating: 4.9,
          reviewCount: 156,
          isVerified: true,
          isFeatured: true,
          status: 'active',
          joinedDate: '2022-11-10T00:00:00Z',
          lastActive: '2025-01-12T08:20:00Z'
        }
      ]
      
      setVendors(mockVendors)
    } catch (error) {
      console.error('Error loading vendors:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const filterVendors = () => {
    let filtered = vendors

    // Search filter
    if (searchQuery) {
      filtered = filtered.filter(vendor =>
        vendor.companyName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        vendor.businessDescription.toLowerCase().includes(searchQuery.toLowerCase()) ||
        vendor.categories.some(cat => cat.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    }

    // Category filter
    if (selectedFilters.category !== 'all') {
      filtered = filtered.filter(vendor =>
        vendor.categories.includes(selectedFilters.category)
      )
    }

    // Location filter
    if (selectedFilters.location !== 'all') {
      filtered = filtered.filter(vendor =>
        vendor.address.state === selectedFilters.location
      )
    }

    // Certification filter
    if (selectedFilters.certification !== 'all') {
      filtered = filtered.filter(vendor =>
        vendor.certifications.includes(selectedFilters.certification)
      )
    }

    // Minimum order filter
    if (selectedFilters.minimumOrder !== 'all') {
      const maxOrder = parseInt(selectedFilters.minimumOrder)
      filtered = filtered.filter(vendor =>
        vendor.minimumOrderValue <= maxOrder
      )
    }

    // Sorting
    filtered.sort((a, b) => {
      switch (selectedFilters.sort) {
        case 'rating':
          return b.rating - a.rating
        case 'reviews':
          return b.reviewCount - a.reviewCount
        case 'name':
          return a.companyName.localeCompare(b.companyName)
        case 'newest':
          return new Date(b.joinedDate).getTime() - new Date(a.joinedDate).getTime()
        case 'products':
          return b.productCount - a.productCount
        default:
          return 0
      }
    })

    setFilteredVendors(filtered)
  }

  const handleFilterChange = (filterType: string, value: string) => {
    setSelectedFilters(prev => ({
      ...prev,
      [filterType]: value
    }))
  }

  if (!user || user.role !== 'wholesale') {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
          <p className="text-yellow-800">
            Vendor directory is available to wholesale customers only. 
            <button 
              onClick={() => navigate('/wholesale')}
              className="ml-2 text-purple-600 hover:text-purple-700 font-medium"
            >
              Apply for wholesale access →
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

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Vendor Directory</h1>
        <p className="text-gray-600">
          Discover and connect with verified wholesale suppliers
        </p>
      </div>

      {/* Search and Filters */}
      <div className="bg-white rounded-lg shadow p-6 mb-8">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between mb-6">
          <div className="flex-1 lg:mr-6 mb-4 lg:mb-0">
            <div className="relative">
              <input
                type="text"
                placeholder="Search vendors, products, or categories..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-purple-500 focus:border-purple-500"
              />
              <svg className="w-5 h-5 text-gray-400 absolute left-3 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>
          
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-2 rounded ${viewMode === 'grid' ? 'bg-purple-100 text-purple-600' : 'text-gray-400'}`}
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M3 3h7v7H3V3zm11 0h7v7h-7V3zM3 14h7v7H3v-7zm11 0h7v7h-7v-7z"/>
                </svg>
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-2 rounded ${viewMode === 'list' ? 'bg-purple-100 text-purple-600' : 'text-gray-400'}`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <select
            value={selectedFilters.category}
            onChange={(e) => handleFilterChange('category', e.target.value)}
            className="form-select"
          >
            <option value="all">All Categories</option>
            <option value="shirts">T-Shirts</option>
            <option value="hoodies">Hoodies</option>
            <option value="dtf-transfers">DTF Transfers</option>
            <option value="tumblers">Tumblers</option>
            <option value="3d-models">3D Models</option>
          </select>

          <select
            value={selectedFilters.location}
            onChange={(e) => handleFilterChange('location', e.target.value)}
            className="form-select"
          >
            <option value="all">All Locations</option>
            <option value="CA">California</option>
            <option value="FL">Florida</option>
            <option value="OR">Oregon</option>
            <option value="NY">New York</option>
            <option value="TX">Texas</option>
          </select>

          <select
            value={selectedFilters.certification}
            onChange={(e) => handleFilterChange('certification', e.target.value)}
            className="form-select"
          >
            <option value="all">All Certifications</option>
            <option value="ISO 9001">ISO 9001</option>
            <option value="OEKO-TEX">OEKO-TEX</option>
            <option value="B-Corp">B-Corp</option>
            <option value="Fair Trade">Fair Trade</option>
          </select>

          <select
            value={selectedFilters.minimumOrder}
            onChange={(e) => handleFilterChange('minimumOrder', e.target.value)}
            className="form-select"
          >
            <option value="all">Any Minimum</option>
            <option value="100">Under $100</option>
            <option value="250">Under $250</option>
            <option value="500">Under $500</option>
            <option value="1000">Under $1,000</option>
          </select>

          <select
            value={selectedFilters.sort}
            onChange={(e) => handleFilterChange('sort', e.target.value)}
            className="form-select"
          >
            <option value="rating">Highest Rated</option>
            <option value="reviews">Most Reviews</option>
            <option value="name">Name A-Z</option>
            <option value="newest">Newest</option>
            <option value="products">Most Products</option>
          </select>
        </div>
      </div>

      {/* Results Count */}
      <div className="mb-6">
        <p className="text-gray-600">
          Showing {filteredVendors.length} of {vendors.length} vendors
        </p>
      </div>

      {/* Vendors Grid/List */}
      {viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredVendors.map((vendor) => (
            <VendorCard key={vendor.id} vendor={vendor} />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {filteredVendors.map((vendor) => (
            <VendorListItem key={vendor.id} vendor={vendor} />
          ))}
        </div>
      )}

      {filteredVendors.length === 0 && (
        <div className="text-center py-12">
          <svg className="w-12 h-12 mx-auto mb-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No vendors found</h3>
          <p className="text-gray-500">Try adjusting your search criteria or filters</p>
        </div>
      )}
    </div>
  )
}

// Vendor Card Component
const VendorCard: React.FC<{ vendor: WholesaleVendor }> = ({ vendor }) => {
  const navigate = useNavigate()

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden hover:shadow-lg transition-shadow">
      {vendor.coverImage && (
        <img
          src={vendor.coverImage}
          alt={vendor.companyName}
          className="w-full h-32 object-cover"
        />
      )}
      
      <div className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center">
            {vendor.logo && (
              <img
                src={vendor.logo}
                alt={vendor.companyName}
                className="w-12 h-12 rounded-full mr-3"
              />
            )}
            <div>
              <h3 className="text-lg font-medium text-gray-900 flex items-center">
                {vendor.companyName}
                {vendor.isVerified && (
                  <svg className="w-4 h-4 text-blue-500 ml-1" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                  </svg>
                )}
                {vendor.isFeatured && (
                  <span className="ml-2 bg-yellow-100 text-yellow-800 text-xs px-2 py-1 rounded">
                    Featured
                  </span>
                )}
              </h3>
              <p className="text-sm text-gray-500">{vendor.address.city}, {vendor.address.state}</p>
            </div>
          </div>
        </div>

        <p className="text-gray-600 text-sm mb-4 line-clamp-2">{vendor.businessDescription}</p>

        <div className="flex items-center mb-4">
          <div className="flex items-center mr-4">
            <div className="flex items-center">
              {[...Array(5)].map((_, i) => (
                <svg
                  key={i}
                  className={`w-4 h-4 ${i < Math.floor(vendor.rating) ? 'text-yellow-400' : 'text-gray-300'}`}
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                </svg>
              ))}
            </div>
            <span className="ml-1 text-sm text-gray-500">({vendor.reviewCount})</span>
          </div>
        </div>

        <div className="space-y-2 mb-4">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Products:</span>
            <span className="font-medium">{vendor.productCount}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Min Order:</span>
            <span className="font-medium">${vendor.minimumOrderValue}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Lead Time:</span>
            <span className="font-medium">{vendor.leadTime} days</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-1 mb-4">
          {vendor.categories.slice(0, 3).map((category) => (
            <span
              key={category}
              className="bg-purple-100 text-purple-800 text-xs px-2 py-1 rounded"
            >
              {category}
            </span>
          ))}
          {vendor.categories.length > 3 && (
            <span className="text-xs text-gray-500">+{vendor.categories.length - 3} more</span>
          )}
        </div>

        <div className="space-y-2">
          <button
            onClick={() => navigate(`/vendor/${vendor.id}`)}
            className="btn-primary w-full text-sm"
          >
            View Catalog
          </button>
          <button className="btn-secondary w-full text-sm">
            Contact Vendor
          </button>
        </div>
      </div>
    </div>
  )
}

// Vendor List Item Component
const VendorListItem: React.FC<{ vendor: WholesaleVendor }> = ({ vendor }) => {
  const navigate = useNavigate()

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-start justify-between">
        <div className="flex items-start">
          {vendor.logo && (
            <img
              src={vendor.logo}
              alt={vendor.companyName}
              className="w-16 h-16 rounded-lg mr-4"
            />
          )}
          <div className="flex-1">
            <h3 className="text-xl font-medium text-gray-900 flex items-center mb-2">
              {vendor.companyName}
              {vendor.isVerified && (
                <svg className="w-5 h-5 text-blue-500 ml-2" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                </svg>
              )}
              {vendor.isFeatured && (
                <span className="ml-2 bg-yellow-100 text-yellow-800 text-sm px-2 py-1 rounded">
                  Featured
                </span>
              )}
            </h3>
            <p className="text-gray-600 mb-3">{vendor.businessDescription}</p>
            
            <div className="flex items-center space-x-6 mb-3">
              <div className="flex items-center">
                <div className="flex items-center">
                  {[...Array(5)].map((_, i) => (
                    <svg
                      key={i}
                      className={`w-4 h-4 ${i < Math.floor(vendor.rating) ? 'text-yellow-400' : 'text-gray-300'}`}
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                    </svg>
                  ))}
                </div>
                <span className="ml-1 text-sm text-gray-500">({vendor.reviewCount} reviews)</span>
              </div>
              
              <span className="text-sm text-gray-500">
                {vendor.address.city}, {vendor.address.state}
              </span>
              
              <span className="text-sm text-gray-500">
                {vendor.productCount} products
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              {vendor.categories.map((category) => (
                <span
                  key={category}
                  className="bg-purple-100 text-purple-800 text-sm px-3 py-1 rounded"
                >
                  {category}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="text-right ml-6">
          <div className="space-y-2 mb-4">
            <div>
              <p className="text-sm text-gray-500">Min Order</p>
              <p className="font-medium">${vendor.minimumOrderValue}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Lead Time</p>
              <p className="font-medium">{vendor.leadTime} days</p>
            </div>
          </div>
          
          <div className="space-y-2">
            <button
              onClick={() => navigate(`/vendor/${vendor.id}`)}
              className="btn-primary text-sm px-4 py-2"
            >
              View Catalog
            </button>
            <button className="btn-secondary text-sm px-4 py-2 ml-2">
              Contact
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default VendorDirectory