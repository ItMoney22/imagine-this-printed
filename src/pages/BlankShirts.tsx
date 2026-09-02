import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, Shirt, Tag, Scissors, Truck, Package } from 'lucide-react'
import { BLANK_LABEL_NOTE, compareToLabel } from '../../backend/shared/blank-line'
import {
  loadBlankTierCards,
  tierSizePrice,
  tierWhiteSizePrice,
  COMPARE_SIZE_ROWS,
  type BlankTierCard
} from '../lib/blank-lane'

// /blanks — the blank-tee lane (David 2026-09-02).
//
// Four house-branded quality rungs — Good / Better / Best / Top Line — sold
// plain with our label. The manufacturer is never our product name; it shows
// only on the "Compared to" line. Every stat on this page comes from the
// shared blank line table (backend/shared/blank-line.ts); prices come from
// the live product rows the seed wrote (cost × markup), falling back to the
// same table when a tier is not seeded yet.

// Mid-tone text so the badge reads on BOTH themes (.theme-neon-light has a
// near-white card; 200-level text vanished there).
const GRADE_STYLES: Record<string, string> = {
  Good: 'bg-slate-500/15 text-slate-500 border-slate-400/40',
  Better: 'bg-sky-500/15 text-sky-500 border-sky-400/40',
  Best: 'bg-purple-500/15 text-purple-500 border-purple-400/40',
  'Top Line': 'bg-amber-400/20 text-amber-600 border-amber-400/50'
}

const money = (v: number | null) => (v === null ? '—' : `$${v.toFixed(2)}`)

const BlankShirts: React.FC = () => {
  const [cards, setCards] = useState<BlankTierCard[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    loadBlankTierCards()
      .then(c => { if (!cancelled) setCards(c) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    document.title = 'Blank Tees — Good, Better, Best & Top Line | Imagine This Printed'
  }, [])

  return (
    <div className="bg-bg">
      {/* Hero */}
      <section className="relative overflow-hidden bg-slate-950 py-14 sm:py-24">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-32 left-1/3 w-[32rem] h-[32rem] bg-purple-600/20 rounded-full blur-[160px]" />
          <div className="absolute bottom-0 right-1/4 w-80 h-80 bg-amber-400/10 rounded-full blur-[120px]" />
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center">
          <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 border border-white/15 text-slate-200 text-xs sm:text-sm font-medium mb-5">
            <Shirt className="w-4 h-4" />
            Blank Tees · Our Label
          </span>
          <h1 className="font-display text-4xl sm:text-5xl md:text-6xl text-white leading-[1.05] mb-5">
            Good. Better. Best.
            <br />
            <span className="bg-gradient-to-r from-amber-200 via-amber-300 to-orange-300 bg-clip-text text-transparent">
              And the Top Line.
            </span>
          </h1>
          <p className="text-slate-300 text-base sm:text-xl leading-relaxed max-w-2xl mx-auto mb-8">
            The exact blanks we print on — tag out, our label in — sold plain. Four quality rungs,
            every stat on the table, priced just over wholesale. Mix any sizes and colours, no minimums.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4">
            <a
              href="#tiers"
              className="group w-full sm:w-auto inline-flex items-center justify-center gap-2 px-7 py-3.5 bg-white text-slate-900 font-semibold rounded-full hover:bg-amber-200 transition-all shadow-lg shadow-black/30 hover:-translate-y-0.5"
            >
              Shop the four
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            </a>
            <a
              href="#compare"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-7 py-3.5 bg-white/10 border border-white/25 text-white font-semibold rounded-full hover:bg-white/20 transition-all"
            >
              Compare the specs
            </a>
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-slate-400 text-xs sm:text-sm">
            <span className="flex items-center gap-1.5"><Scissors className="w-4 h-4 text-amber-300" /> Relabeled by hand</span>
            <span className="flex items-center gap-1.5"><Package className="w-4 h-4 text-amber-300" /> Same shirts under our prints</span>
            <span className="flex items-center gap-1.5"><Truck className="w-4 h-4 text-amber-300" /> Ships from Rockmart, GA</span>
          </div>
        </div>
      </section>

      {/* Tier cards */}
      <section id="tiers" className="py-12 sm:py-20 scroll-mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-8 sm:mb-12">
            <h2 className="font-display text-2xl sm:text-4xl text-text mb-3">Pick your rung</h2>
            <p className="text-muted max-w-2xl mx-auto text-sm sm:text-base">
              Lighter and softer as you climb, until the top line — a heavyweight that only gets better with washing.
            </p>
          </div>

          {loading && cards.length === 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className="rounded-2xl border card-border bg-card animate-pulse aspect-[3/4]" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {cards.map(card => {
                const t = card.tier
                return (
                  <div
                    key={t.id}
                    className={`group relative flex flex-col rounded-2xl border bg-card overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-glow ${
                      t.grade === 'Top Line' ? 'border-amber-400/50' : 'card-border'
                    }`}
                  >
                    <Link to={card.href} className="block aspect-square bg-slate-200/80 overflow-hidden">
                      <img
                        src={card.image}
                        alt={`${t.name} in ${t.heroColor}`}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        loading="lazy"
                      />
                    </Link>
                    <div className="flex flex-col flex-1 p-4 sm:p-5">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className={`text-[11px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border ${GRADE_STYLES[t.grade]}`}>
                          {t.grade}
                        </span>
                        <span className="text-xs text-muted">{t.specs.weightOz} oz</span>
                      </div>
                      <h3 className="font-display text-lg sm:text-xl text-text leading-snug">{t.name}</h3>
                      <p className="text-xs text-muted mt-1">{compareToLabel(t)}</p>
                      <p className="text-sm text-muted mt-3 leading-relaxed">{t.tagline}</p>

                      <dl className="mt-4 grid grid-cols-2 gap-y-1.5 text-xs">
                        <dt className="text-muted">Fabric</dt>
                        <dd className="text-text text-right">{t.specs.fabric.split(' (')[0]}</dd>
                        <dt className="text-muted">Fit</dt>
                        <dd className="text-text text-right">{t.specs.fit.split(' —')[0]}</dd>
                        <dt className="text-muted">Body</dt>
                        <dd className="text-text text-right capitalize">{t.specs.seams}</dd>
                        <dt className="text-muted">Sizes</dt>
                        <dd className="text-text text-right">{card.sizes[0]}–{card.sizes[card.sizes.length - 1]}</dd>
                        <dt className="text-muted">Colours</dt>
                        <dd className="text-text text-right">{card.colorCount}</dd>
                      </dl>

                      <div className="mt-auto pt-4 flex items-end justify-between gap-3">
                        <div>
                          <p className="text-[11px] text-muted">from</p>
                          <p className="text-2xl font-bold text-primary drop-shadow-[0_0_10px_rgba(168,85,247,0.4)]">${card.fromPrice.toFixed(2)}</p>
                        </div>
                        <Link
                          to={card.href}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-primary text-white text-sm font-semibold hover:opacity-90 transition-opacity shadow-glowSm"
                        >
                          {card.live ? 'Shop' : 'View'}
                          <ArrowRight className="w-4 h-4" />
                        </Link>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>

      {/* Comparison table */}
      <section id="compare" className="py-12 sm:py-20 bg-card/40 border-y card-border scroll-mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-8 sm:mb-12">
            <h2 className="font-display text-2xl sm:text-4xl text-text mb-3">The whole spec sheet</h2>
            <p className="text-muted max-w-2xl mx-auto text-sm sm:text-base">
              Weight, yarn, seams, collar, sizes, colours and the price at every size — side by side.
            </p>
          </div>

          <div className="overflow-x-auto rounded-2xl border card-border bg-card">
            <table className="min-w-[860px] w-full text-sm">
              <thead>
                <tr className="border-b card-border">
                  <th className="text-left p-4 text-muted font-medium w-44">Spec</th>
                  {cards.map(c => (
                    <th key={c.tier.id} className="p-4 text-left align-top">
                      <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border mb-1.5 ${GRADE_STYLES[c.tier.grade]}`}>
                        {c.tier.grade}
                      </span>
                      <div className="text-text font-semibold leading-snug">{c.tier.name}</div>
                      <div className="text-[11px] text-muted font-normal mt-0.5">{compareToLabel(c.tier)}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="[&>tr:nth-child(even)]:bg-bg/40">
                <Row label="Weight" cells={cards.map(c => `${c.tier.specs.weightOz} oz`)} strong />
                <Row label="Fabric" cells={cards.map(c => c.tier.specs.fabric)} />
                <Row label="Fit" cells={cards.map(c => c.tier.specs.fit)} />
                <Row label="Body" cells={cards.map(c => (c.tier.specs.seams === 'side-seamed' ? 'Side-seamed' : 'Tubular (no side seams)'))} />
                <Row label="Collar" cells={cards.map(c => c.tier.specs.collar)} />
                <tr>
                  <td className="p-4 text-muted align-top">Construction</td>
                  {cards.map(c => (
                    <td key={c.tier.id} className="p-4 align-top">
                      <ul className="space-y-1">
                        {c.tier.specs.construction.map(line => (
                          <li key={line} className="flex items-start gap-1.5 text-text text-xs sm:text-sm">
                            <Check className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                            <span>{line}</span>
                          </li>
                        ))}
                      </ul>
                    </td>
                  ))}
                </tr>
                <Row label="Label" cells={cards.map(c => c.tier.specs.label)} />
                <Row label="Best for" cells={cards.map(c => c.tier.specs.bestFor)} />
                <Row label="Sizes" cells={cards.map(c => c.sizes.join(' · '))} />
                <Row label="Colours" cells={cards.map(c => `${c.colorCount} colours`)} />
                {COMPARE_SIZE_ROWS.map(size => (
                  <tr key={size} className="border-t card-border">
                    <td className="p-4 text-muted">
                      Price · {size === 'S' ? 'S–XL' : size}
                      {size === 'S' && <span className="block text-[11px]">each, any colour</span>}
                    </td>
                    {cards.map(c => {
                      const p = tierSizePrice(c, size)
                      const w = tierWhiteSizePrice(c, size)
                      return (
                        <td key={c.tier.id} className="p-4 align-top">
                          <span className="text-text font-semibold">{money(p)}</span>
                          {w !== null && <span className="block text-[11px] text-muted">White {money(w)}</span>}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted mt-3">
            Prices are per shirt. White runs a little less on most rungs. Extended sizes cost more because the mills charge more for them — we pass that through, not pad it.
          </p>
        </div>
      </section>

      {/* Our label */}
      <section className="py-12 sm:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="rounded-2xl border card-border bg-card p-6">
              <Scissors className="w-6 h-6 text-primary mb-3" />
              <h3 className="font-display text-lg text-text mb-2">Tag out, our label in</h3>
              <p className="text-sm text-muted leading-relaxed">{BLANK_LABEL_NOTE}</p>
            </div>
            <div className="rounded-2xl border card-border bg-card p-6">
              <Tag className="w-6 h-6 text-primary mb-3" />
              <h3 className="font-display text-lg text-text mb-2">We tell you what it compares to</h3>
              <p className="text-sm text-muted leading-relaxed">
                We don&apos;t sell under the mills&apos; names, but we won&apos;t hide the ball either. Every rung
                lists the shirt it compares to so you can judge the weight, hand and fit for yourself.
              </p>
            </div>
            <div className="rounded-2xl border card-border bg-card p-6">
              <Package className="w-6 h-6 text-primary mb-3" />
              <h3 className="font-display text-lg text-text mb-2">Priced just over wholesale</h3>
              <p className="text-sm text-muted leading-relaxed">
                We buy blanks by the case for our own printing and pass the price through with a small margin.
                Mix sizes and colours freely — there are no minimums. Need 24+ or a run with your own label?{' '}
                <Link to="/contact" className="text-primary hover:underline">Talk to us</Link>.
              </p>
            </div>
          </div>

          <div className="mt-10 text-center">
            <Link
              to="/catalog/blanks"
              className="inline-flex items-center gap-2 text-sm text-muted hover:text-primary transition-colors"
            >
              Browse every blank in the catalog
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}

const Row: React.FC<{ label: string; cells: string[]; strong?: boolean }> = ({ label, cells, strong }) => (
  <tr>
    <td className="p-4 text-muted align-top">{label}</td>
    {cells.map((cell, i) => (
      <td key={i} className={`p-4 align-top ${strong ? 'text-text font-semibold' : 'text-text'}`}>{cell}</td>
    ))}
  </tr>
)

export default BlankShirts
