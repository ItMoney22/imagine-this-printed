import { Link } from 'react-router-dom'
import { ArrowRight, Boxes, Sparkles } from 'lucide-react'
import type { Product } from '../../types'
import { getGalleryImages } from '../../lib/product-kind'
import { SHOP_PLACE } from '../../config/business-info'
import { PROCESSING_LINE } from '../../utils/shipping-calculator'
import { useReveal } from './useReveal'

/**
 * 3D Toy Factory band. The figurine floats on its turntable in the photo; two
 * real toys from the shop float beside the pitch and open their own pages.
 * The "from" price is the cheapest live figurine, never a typed number.
 */
export function ToyBand({ toys, toyFrom }: { toys: Product[]; toyFrom: number | null }) {
  const ref = useReveal<HTMLElement>()
  const chips = toys.slice(0, 2)
  return (
    <section ref={ref} className="home-reveal relative overflow-hidden">
      <img src="/home/toy-band.webp" alt="" className="home-drift absolute inset-0 w-full h-full object-cover object-[70%_center]" loading="lazy" />
      <div className="absolute inset-0 home-toy-fade" />
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-20 lg:py-24">
        <div className="max-w-md">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-[0.16em] uppercase home-toy-accent mb-3">
            <Boxes className="w-4 h-4" /> 3D Toy Factory
          </span>
          <h2 className="font-display text-3xl sm:text-5xl text-white leading-tight mb-4">
            Invent a creature.
            <span className="block">We print it for real.</span>
          </h2>
          {toyFrom !== null && <p className="text-white/80 mb-6">Figurines from ${toyFrom.toFixed(2)}</p>}
          <Link to="/toys" className="btn-primary home-press group">
            Make a 3D toy
            <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
          </Link>
        </div>
        {chips.length > 0 && (
          <div className="hidden md:flex absolute right-6 lg:right-[38%] bottom-8 gap-4">
            {chips.map((t, i) => (
              <Link
                key={t.id}
                to={`/product/${t.slug || t.id}`}
                className="home-bob home-press w-36 rounded-2xl overflow-hidden bg-card shadow-soft-xl border border-white/20"
                style={{ animationDelay: `${i * 0.8}s` }}
              >
                <img src={getGalleryImages(t)[0] || t.images[0]} alt={t.name} className="w-full aspect-square object-cover" loading="lazy" />
                <span className="block px-2.5 py-2 text-xs text-text font-semibold truncate">{t.name.replace(/^Toy:\s*/i, '')}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

const STEPS = [
  { img: '/home/made-1.webp', title: 'Pick a design or make your own.', line: 'Shop our designs, or start from your own idea.' },
  { img: '/home/made-2.webp', title: `We print it in our ${SHOP_PLACE.town} shop.`, line: 'On our own DTF and 3D printers.' },
  { img: '/home/made-3.webp', title: 'Shipped to your door, or pick it up free.', line: PROCESSING_LINE },
]

/** How it gets made: the shopper's three steps (no seller pitch here). */
export function HowItsMade() {
  const ref = useReveal<HTMLElement>()
  return (
    <section ref={ref} className="home-reveal py-12 sm:py-16 bg-bg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className="font-display text-2xl sm:text-3xl text-text uppercase tracking-wide mb-6 sm:mb-8">How it gets made</h2>
        <ol className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5">
          {STEPS.map((s, i) => (
            <li
              key={s.img}
              className="home-stagger flex items-center gap-4 bg-card rounded-2xl border border-border shadow-soft p-3"
              style={{ transitionDelay: `${i * 90}ms` }}
            >
              <div className="relative w-32 sm:w-36 shrink-0 aspect-[4/3] rounded-xl overflow-hidden">
                <img src={s.img} alt="" className="w-full h-full object-cover" loading="lazy" />
                <span className="absolute top-2 left-2 w-7 h-7 rounded-full bg-primary text-white text-sm font-bold flex items-center justify-center">
                  {i + 1}
                </span>
              </div>
              <div>
                <h3 className="font-display text-base sm:text-lg text-text leading-snug">{s.title}</h3>
                <p className="text-xs sm:text-sm text-muted mt-1">{s.line}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

/** Design your own: Mr. Imagine at his desk, one button into the design studio. */
export function DesignBand() {
  const ref = useReveal<HTMLElement>()
  return (
    <section ref={ref} className="home-reveal py-12 sm:py-16 bg-bg-warm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-10 items-center">
        <div className="home-stagger rounded-3xl overflow-hidden shadow-soft-lg aspect-[16/9]">
          <img src="/home/design-desk.webp" alt="Mr. Imagine sketching a creature at his drawing desk" className="w-full h-full object-cover" loading="lazy" />
        </div>
        <div className="home-stagger text-center md:text-left" style={{ transitionDelay: '120ms' }}>
          <h2 className="font-display text-3xl sm:text-4xl text-text leading-tight mb-3">
            Have an idea?
            <span className="block text-primary">Imagination draws it with you.</span>
          </h2>
          <p className="text-text-secondary mb-6 max-w-md mx-auto md:mx-0">
            Describe it in your own words, pick the version you like, and we print it on a shirt, a toy or metal.
          </p>
          <Link to="/imagination-station" className="btn-primary home-press group">
            <Sparkles className="w-5 h-5" />
            Start designing
            <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
          </Link>
        </div>
      </div>
    </section>
  )
}
