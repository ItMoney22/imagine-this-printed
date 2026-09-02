import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Shirt, Tag, Layers } from 'lucide-react'
import { loadBlankTierCards, type BlankTierCard } from '../lib/blank-lane'

// Home-page band for the blank-tee lane (David 2026-09-02). Four quality
// rungs, house names only (the manufacturer appears solely as "Compared
// to"), live "from" prices. Fetches its own data so Home.tsx stays untouched.
const BlankTeesSection: React.FC = () => {
  const [cards, setCards] = useState<BlankTierCard[]>([])

  useEffect(() => {
    let cancelled = false
    loadBlankTierCards().then(c => { if (!cancelled) setCards(c) })
    return () => { cancelled = true }
  }, [])

  return (
    <section className="py-12 sm:py-20 bg-slate-950 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none hidden sm:block">
        <div className="absolute -top-24 right-1/4 w-[28rem] h-[28rem] bg-purple-600/15 rounded-full blur-[140px]" />
        <div className="absolute bottom-0 left-1/5 w-72 h-72 bg-amber-400/10 rounded-full blur-[120px]" />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 lg:gap-12 items-center">
          {/* Pitch */}
          <div className="lg:col-span-2 text-center lg:text-left">
            <span className="inline-flex items-center gap-2 px-3 sm:px-4 py-1 sm:py-1.5 rounded-full bg-white/10 border border-white/15 text-slate-200 text-xs sm:text-sm font-medium mb-3 sm:mb-4">
              <Shirt className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              Blank Tees · Our Label
            </span>
            <h2 className="font-display text-3xl sm:text-4xl md:text-5xl text-white leading-tight mb-4">
              Good. Better. Best.
              <br />
              <span className="bg-gradient-to-r from-amber-200 via-amber-300 to-orange-300 bg-clip-text text-transparent">
                And the Top Line.
              </span>
            </h2>
            <p className="text-slate-300 text-sm sm:text-lg leading-relaxed mb-6 max-w-lg mx-auto lg:mx-0">
              The same relabeled blanks we print on, sold plain. Four quality rungs with real spec
              sheets, priced just over wholesale. Mix any sizes and colours — no minimums.
            </p>
            <div className="flex flex-wrap items-center justify-center lg:justify-start gap-x-5 gap-y-2 mb-6 text-slate-300 text-xs sm:text-sm">
              <span className="flex items-center gap-1.5"><Tag className="w-4 h-4 text-amber-300" /> Manufacturer tag out, ours in</span>
              <span className="flex items-center gap-1.5"><Layers className="w-4 h-4 text-amber-300" /> 4.2 oz to 6.1 oz</span>
            </div>
            <Link
              to="/blanks"
              className="group inline-flex items-center justify-center gap-2 px-6 sm:px-8 py-3 sm:py-4 bg-white text-slate-900 font-semibold rounded-full hover:bg-amber-200 transition-all duration-300 shadow-lg shadow-black/30 hover:-translate-y-0.5 text-sm sm:text-base"
            >
              Compare the four
              <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>

          {/* The ladder */}
          <div className="lg:col-span-3 grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
            {cards.map(card => (
              <Link
                key={card.tier.id}
                to={card.href}
                className="group relative rounded-2xl overflow-hidden border border-white/10 bg-white/5 hover:bg-white/10 hover:border-amber-300/40 transition-all duration-300 hover:-translate-y-1"
              >
                <div className="aspect-square bg-slate-200/90 overflow-hidden">
                  <img
                    src={card.image}
                    alt={`${card.tier.name} blank`}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    loading="lazy"
                  />
                </div>
                <div className="p-3 sm:p-4">
                  <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-amber-300">
                    {card.tier.grade}
                  </span>
                  <p className="text-white text-sm sm:text-base font-semibold leading-snug mt-0.5">
                    {card.tier.name.replace(/ Tee$/, '')}
                  </p>
                  <p className="text-slate-400 text-xs mt-1">{card.tier.specs.weightOz} oz · {card.colorCount} colours</p>
                  <p className="text-white text-sm sm:text-base font-bold mt-2">
                    <span className="text-xs font-medium text-slate-400 mr-1">from</span>${card.fromPrice.toFixed(2)}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

export default BlankTeesSection
