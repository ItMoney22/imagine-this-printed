import { Link } from 'react-router-dom'
import { ArrowRight, MapPin, Store, ShieldCheck, MessageCircle } from 'lucide-react'
import { SHOP_PLACE } from '../../config/business-info'

/**
 * Home hero (approved mock 7eb9469c, 2026-10-07): what the shop is, where it
 * is, one button to shop. The scene is a real listing (the lion tee and the
 * Wizard Beast toy) with Mr. Imagine peeking in.
 */
export function HomeHero() {
  return (
    <section className="relative overflow-hidden bg-bg-warm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-10 sm:pt-12 lg:py-16 grid grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-8 lg:gap-12 items-center">
        <div className="text-center lg:text-left">
          <p className="home-rise home-rise-1 text-[11px] sm:text-xs font-semibold tracking-[0.18em] uppercase text-primary mb-3 sm:mb-4">
            Printed to order in {SHOP_PLACE.town}, {SHOP_PLACE.stateName}
          </p>
          <h1 className="home-rise home-rise-2 font-display text-5xl sm:text-6xl xl:text-7xl text-text leading-[1.02] mb-4 sm:mb-6">
            Imagine It.
            <span className="block text-primary">Print It.</span>
          </h1>
          <p className="home-rise home-rise-3 text-base sm:text-lg text-text-secondary leading-relaxed max-w-md mx-auto lg:mx-0 mb-6 sm:mb-8">
            Shirts, hoodies, 3D-printed toys and metal art, made in our shop and shipped to your door.
          </p>
          <div className="home-rise home-rise-4 flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-3 sm:gap-6">
            <Link to="/catalog" className="btn-primary home-press w-full sm:w-auto group">
              Shop the store
              <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
            </Link>
            <Link
              to="/imagination-station"
              className="text-sm font-semibold text-primary underline underline-offset-4 decoration-primary/40 hover:decoration-primary py-2"
            >
              Design your own
            </Link>
          </div>
        </div>

        <div className="home-scene relative">
          <div className="home-sweep relative overflow-hidden rounded-3xl shadow-soft-xl aspect-[3/2] bg-card">
            <img
              src="/home/hero.webp"
              alt="A lion graphic tee, a 3D-printed toy on a turntable and a metal art print in our shop, with Mr. Imagine peeking in"
              className="home-drift absolute inset-0 w-full h-full object-cover"
              width={1400}
              height={938}
              fetchPriority="high"
            />
          </div>
        </div>
      </div>
    </section>
  )
}

const TRUST = [
  { icon: MapPin, text: `Printed in ${SHOP_PLACE.town}, ${SHOP_PLACE.stateCode}` },
  { icon: Store, text: `Free local pickup in ${SHOP_PLACE.town}` },
  { icon: ShieldCheck, text: 'Secure checkout' },
  { icon: MessageCircle, text: 'Real people answer', to: '/contact', cta: 'Contact us' },
]

/** Four plain facts under the hero. Every one is true today (pickup = shipping-calculator's free local rate). */
export function TrustStrip() {
  return (
    <section className="border-y border-border bg-card">
      <ul className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 grid grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-3">
        {TRUST.map(({ icon: Icon, text, to, cta }) => (
          <li key={text} className="flex items-center gap-2.5 text-xs sm:text-sm text-text-secondary lg:justify-center">
            <Icon className="w-5 h-5 shrink-0 text-primary" strokeWidth={1.75} />
            <span>
              {text}
              {to && (
                <>
                  {', '}
                  <Link to={to} className="text-primary font-medium hover:underline">
                    {cta}
                  </Link>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
