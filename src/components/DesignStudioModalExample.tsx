import React, { useState } from 'react'
import DesignStudioModal from './DesignStudioModal'
import type { Product } from '../types'

/**
 * Example component demonstrating how to use DesignStudioModal
 *
 * This can be integrated into:
 * - ProductCard.tsx: Add "Customize" button
 * - ProductPage.tsx: Add "Customize This Product" button
 * - ProductCatalog.tsx: Add design button to each product
 * - Navbar.tsx: Add "Design Studio" link
 */
const DesignStudioModalExample: React.FC = () => {
  const [isModalOpen, setIsModalOpen] = useState(false)

  // Example product - in real usage, this would come from props or state
  const exampleProduct: Product = {
    id: 'example-shirt-1',
    name: 'Premium Cotton T-Shirt',
    description: 'High-quality cotton t-shirt perfect for custom designs',
    price: 24.99,
    images: ['https://example.com/shirt.jpg'],
    category: 'shirts',
    inStock: true
  }

  return (
    <div className="p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-text mb-4">Design Studio Modal Example</h1>
        <p className="text-muted mb-6">
          Click the button below to open the Design Studio modal. This modal provides a full-featured
          design editor with background removal and image upscaling capabilities.
        </p>

        {/* Example Buttons */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {/* Button 1: Basic usage */}
          <button
            onClick={() => setIsModalOpen(true)}
            className="bg-primary hover:bg-primary/90 text-white font-semibold py-4 px-6 rounded-lg shadow-lg transition-all hover:shadow-glow flex flex-col items-center justify-center gap-2"
          >
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
            </svg>
            <span>Open Design Studio</span>
          </button>

          {/* Button 2: With product context */}
          <button
            onClick={() => setIsModalOpen(true)}
            className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-semibold py-4 px-6 rounded-lg shadow-lg transition-all hover:shadow-glow flex flex-col items-center justify-center gap-2"
          >
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            <span>Customize Product</span>
          </button>

          {/* Button 3: Alternative style */}
          <button
            onClick={() => setIsModalOpen(true)}
            className="bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white font-semibold py-4 px-6 rounded-lg shadow-lg transition-all hover:shadow-glow flex flex-col items-center justify-center gap-2"
          >
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span>Start Designing</span>
          </button>
        </div>

        {/* Features List */}
        <div className="bg-card border border-primary/20 rounded-lg p-6 shadow-lg">
          <h2 className="text-xl font-bold text-text mb-4">Design Studio Features</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-start gap-3">
              <svg className="w-6 h-6 text-primary flex-shrink-0 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <div>
                <h3 className="font-semibold text-text">Full-Screen Lightbox</h3>
                <p className="text-sm text-muted">Professional modal with dark overlay and backdrop blur</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <svg className="w-6 h-6 text-primary flex-shrink-0 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <div>
                <h3 className="font-semibold text-text">Background Removal</h3>
                <p className="text-sm text-muted">AI-powered background removal for 10 ITC tokens</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <svg className="w-6 h-6 text-primary flex-shrink-0 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <div>
                <h3 className="font-semibold text-text">Image Upscaling</h3>
                <p className="text-sm text-muted">2x or 4x upscaling for 15 ITC tokens</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <svg className="w-6 h-6 text-primary flex-shrink-0 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <div>
                <h3 className="font-semibold text-text">Mockup Preview</h3>
                <p className="text-sm text-muted">Real-time preview with realistic mockup generation</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <svg className="w-6 h-6 text-primary flex-shrink-0 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <div>
                <h3 className="font-semibold text-text">Drag & Drop Canvas</h3>
                <p className="text-sm text-muted">Intuitive Konva.js canvas with transform controls</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <svg className="w-6 h-6 text-primary flex-shrink-0 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <div>
                <h3 className="font-semibold text-text">Text Tools</h3>
                <p className="text-sm text-muted">Add custom text with font selection and color picker</p>
              </div>
            </div>
          </div>
        </div>

        {/* Integration Code Example */}
        <div className="mt-8 bg-gray-900 text-gray-100 rounded-lg p-6 overflow-x-auto">
          <h2 className="text-lg font-bold mb-4 text-white">Integration Example:</h2>
          <pre className="text-sm">
{`import DesignStudioModal from './DesignStudioModal'

function ProductCard({ product }) {
  const [showDesigner, setShowDesigner] = useState(false)

  return (
    <div>
      <button onClick={() => setShowDesigner(true)}>
        Customize Design
      </button>

      <DesignStudioModal
        isOpen={showDesigner}
        onClose={() => setShowDesigner(false)}
        product={product}
        template="shirt"
      />
    </div>
  )
}`}
          </pre>
        </div>
      </div>

      {/* The Modal */}
      <DesignStudioModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        product={exampleProduct}
        template="shirt"
      />
    </div>
  )
}

export default DesignStudioModalExample

