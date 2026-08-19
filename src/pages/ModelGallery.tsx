// Toy Shop — the customer-facing 3D toy storefront (rewritten 2026-08-19).
// The previous ModelGallery rendered HARDCODED mock data behind a login wall,
// so a regular customer could never see a real toy. This page now lists real,
// active 3D-print products from `products` (same predicate as ProductCatalog's
// "3D Prints" pill + the print bridge), links each to its product page, and
// funnels creators into the Toy Creator. Public — no login needed to browse.
import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Product } from '../types'
import ThreeDPrintRequestModal from '../components/ThreeDPrintRequestModal'

interface PaletteEntry { hex: string; pct?: number }

const ToyCard: React.FC<{ product: Product }> = ({ product }) => {
  const print3d = (product.metadata?.print3d ?? {}) as Record<string, any>
  const palette: PaletteEntry[] = Array.isArray(print3d.palette) ? print3d.palette : []
  const fullColor = print3d.color_mode === 'color4'
  const image = product.images?.[0]

  return (
    <Link
      to={`/product/${product.slug || product.id}`}
      className="bg-card rounded-xl shadow-lg overflow-hidden hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-1 group block"
    >
      <div className="relative overflow-hidden">
        <img
          src={image || '/itc-coin.png'}
          alt={product.altText || product.name}
          className="w-full h-56 object-cover transform group-hover:scale-110 transition-transform duration-500"
          loading="lazy"
        />
        <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
          {fullColor && (
            <span className="bg-gradient-to-r from-fuchsia-600 to-amber-500 text-white px-2 py-1 rounded text-xs font-bold shadow-sm">
              FULL COLOR
            </span>
          )}
          <span className="bg-black/70 text-white px-2 py-1 rounded text-xs font-medium backdrop-blur-sm">
            🧲 magnet hands
          </span>
        </div>
      </div>
      <div className="p-5">
        <h3 className="text-lg font-bold text-text mb-1 group-hover:text-primary transition-colors line-clamp-1">
          {product.name.replace(/^Toy:\s*/i, '')}
        </h3>
        <p className="text-muted text-sm mb-3 line-clamp-2">{product.description}</p>
        {palette.length > 0 && (
          <div className="flex items-center gap-1.5 mb-3" title="Printed in these colors">
            <span className="text-xs text-muted mr-1">Colors:</span>
            {palette.slice(0, 4).map((p, i) => (
              <span
                key={i}
                className="w-4 h-4 rounded-full border border-white/30 shadow-sm"
                style={{ backgroundColor: p.hex }}
              />
            ))}
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-xl font-bold text-text">${Number(product.price).toFixed(2)}</span>
          <span className="bg-primary text-white text-sm font-bold py-1.5 px-4 rounded-lg shadow-md group-hover:shadow-lg transition-shadow">
            View toy
          </span>
        </div>
      </div>
    </Link>
  )
}

const ModelGallery: React.FC = () => {
  const [toys, setToys] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [showPrintRequestModal, setShowPrintRequestModal] = useState(false)

  useEffect(() => {
    const loadToys = async () => {
      try {
        // Same 3D predicate ProductCatalog's "3D Prints" pill uses, restricted
        // to live products. Toys promoted from the Toy Lab land here once an
        // admin activates them.
        const { data, error } = await supabase
          .from('products')
          .select('*')
          .eq('is_active', true)
          .eq('status', 'active')
          .or('category.ilike.%3d%,category.ilike.%toy%,metadata->>product_template.ilike.%3d%,metadata->>category.ilike.%3d%')
          .order('created_at', { ascending: false })
          .limit(60)
        if (error) throw error
        setToys(
          (data || []).map((d: any): Product => ({
            id: d.id,
            slug: d.slug || undefined,
            name: d.name,
            description: d.description || '',
            price: d.price || 0,
            images: d.images || [],
            category: d.category || '3d-prints',
            inStock: true,
            metadata: d.metadata || {},
            altText: d.alt_text || undefined
          }))
        )
      } catch (err) {
        console.error('[ToyShop] load failed:', err)
      } finally {
        setLoading(false)
      }
    }
    void loadToys()
  }, [])

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Hero */}
      <div className="mb-8 bg-gradient-to-r from-gray-900 to-gray-800 rounded-2xl p-8 text-white shadow-xl overflow-hidden relative">
        <div className="absolute top-0 right-0 w-64 h-64 bg-purple-600 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob"></div>
        <div className="absolute -bottom-8 -left-8 w-64 h-64 bg-indigo-600 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob animation-delay-2000"></div>
        <div className="relative z-10 flex flex-col md:flex-row justify-between items-center">
          <div className="mb-6 md:mb-0">
            <h1 className="text-4xl font-bold mb-2 bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-300">
              3D Toy Shop
            </h1>
            <p className="text-gray-300 text-lg max-w-xl">
              Collectible figures printed in full color, with hidden magnets in the hands —
              snap on weapons, pets and extra parts. Or grab a paint kit matched to your
              toy's exact colors and paint it at home.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-4">
            <Link
              to="/toy-creator"
              className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-bold py-3 px-6 rounded-xl shadow-lg transform transition-all hover:scale-105 text-center"
            >
              ✨ Create Your Own Toy
            </Link>
            <button
              onClick={() => setShowPrintRequestModal(true)}
              className="bg-gray-700 hover:bg-gray-600 text-white font-semibold py-3 px-6 rounded-xl transition-colors border border-gray-600"
            >
              Request Custom Print
            </button>
          </div>
        </div>
      </div>

      {/* Toys grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-card rounded-xl shadow-lg h-96 animate-pulse" />
          ))}
        </div>
      ) : toys.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {toys.map(toy => (
            <ToyCard key={toy.id} product={toy} />
          ))}
        </div>
      ) : (
        <div className="text-center py-16 bg-card rounded-2xl shadow-inner">
          <h3 className="text-xl font-bold text-text mb-2">The first drop is printing now 🖨️</h3>
          <p className="text-muted mb-6">
            Our catalog toys are on the printers. Beat the drop — design your own
            one-of-a-kind figure and we'll print it for you.
          </p>
          <Link
            to="/toy-creator"
            className="inline-block bg-primary text-white font-bold py-3 px-8 rounded-xl shadow-lg hover:opacity-90 transition-opacity"
          >
            ✨ Open the Toy Creator
          </Link>
        </div>
      )}

      {/* How it works */}
      <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-card rounded-xl p-6 border card-border">
          <div className="text-3xl mb-2">🎨</div>
          <h3 className="font-bold text-text mb-1">Full color or paint-it-yourself</h3>
          <p className="text-sm text-muted">
            Printed in up to 4 vibrant colors — or order it plain with a paint kit that
            includes the exact paints for your toy. A perfect project for kids.
          </p>
        </div>
        <div className="bg-card rounded-xl p-6 border card-border">
          <div className="text-3xl mb-2">🧲</div>
          <h3 className="font-bold text-text mb-1">Magnet hands, endless add-ons</h3>
          <p className="text-sm text-muted">
            Every figure hides magnets in its palms. Snap-on weapon packs, pet companions
            and extra parts are available with every toy.
          </p>
        </div>
        <div className="bg-card rounded-xl p-6 border card-border">
          <div className="text-3xl mb-2">📱</div>
          <h3 className="font-bold text-text mb-1">NFC magic in the base</h3>
          <p className="text-sm text-muted">
            Tap the base with a phone to open your toy's AR experience — see it come to
            life in 3D on your screen.
          </p>
        </div>
      </div>

      {/* Print Request Modal */}
      <ThreeDPrintRequestModal
        isOpen={showPrintRequestModal}
        onClose={() => setShowPrintRequestModal(false)}
      />
    </div>
  )
}

export default ModelGallery
