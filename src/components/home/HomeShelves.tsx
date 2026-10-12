import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import ProductCard from '../ProductCard'
import type { Product } from '../../types'
import { SEASONAL_PICKS } from './useHomeShop'
import { useReveal } from './useReveal'

function TileSkeleton() {
  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden animate-pulse">
      <div className="aspect-square bg-border-subtle" />
      <div className="p-4 space-y-2">
        <div className="h-4 bg-border-subtle rounded w-3/4" />
        <div className="h-4 bg-border-subtle rounded w-1/3" />
        <div className="h-9 bg-border-subtle rounded" />
      </div>
    </div>
  )
}

/** Seasonal row: real listings only, gone by itself after SEASONAL_PICKS.endsOn. */
export function SeasonalPicks({ products }: { products: Product[] }) {
  const ref = useReveal<HTMLElement>()
  if (products.length === 0) return null
  return (
    <section ref={ref} className="home-reveal relative overflow-hidden py-10 sm:py-14">
      <img src="/home/halloween-backdrop.webp" alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
      <div className="absolute inset-0 home-wash" />
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,3fr)] gap-6 lg:gap-10 items-center">
        <div>
          <span className="inline-block px-3 py-1 rounded-full bg-primary text-white text-[11px] font-bold tracking-[0.16em] uppercase mb-3">
            {SEASONAL_PICKS.label}
          </span>
          <h2 className="font-display text-3xl sm:text-4xl text-text uppercase tracking-wide">{SEASONAL_PICKS.title}</h2>
          <p className="text-text-secondary mt-2">{SEASONAL_PICKS.line}</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          {products.map((p, i) => (
            <div key={p.id} className="home-stagger" style={{ transitionDelay: `${i * 80}ms` }}>
              <ProductCard product={p} showSocialBadges={false} compact />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/** Popular right now: a whole-card grid (the old carousel started on a cut-off card). */
export function PopularGrid({ products, loading }: { products: Product[]; loading: boolean }) {
  const ref = useReveal<HTMLElement>()
  if (!loading && products.length === 0) return null
  return (
    <section ref={ref} className="home-reveal py-12 sm:py-16 bg-bg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-end justify-between gap-4 mb-6 sm:mb-8">
          <h2 className="font-display text-2xl sm:text-3xl text-text uppercase tracking-wide">Popular right now</h2>
          <Link to="/catalog" className="hidden sm:inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:gap-2.5 transition-all">
            Shop everything <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5">
          {loading
            ? [0, 1, 2, 3].map((i) => <TileSkeleton key={i} />)
            : products.map((p, i) => (
                <div key={p.id} className="home-stagger" style={{ transitionDelay: `${i * 80}ms` }}>
                  <ProductCard product={p} showSocialBadges={false} compact />
                </div>
              ))}
        </div>
        <Link to="/catalog" className="sm:hidden mt-6 flex items-center justify-center gap-1.5 text-sm font-semibold text-primary">
          Shop everything <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </section>
  )
}
