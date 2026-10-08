// The Toy Factory — the home of the 3D toy line (David 2026-08-19), remodelled
// to the mock David approved on 2026-10-07 (approval 2a9ae61e, task b9656cc9):
// the same light shop as the rest of the site, with the Toy Factory's deep teal
// kept for the hero window and the closing band.
// Every toy on the page is a REAL listing (products, 3D, with a print3d record);
// the hero art was rendered from the real Wizard Beast, Robo Rascal and Shadow
// Raptor models. Add-on prices come from TOY_ADDONS (src/lib/product-kind.ts),
// the same table the server charges from.
import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Sword, PawPrint, Magnet, Palette, Leaf, ShieldCheck, Store, UserCheck, FileUp } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { applyStorefrontVisibility } from '../lib/product-visibility'
import { STOREFRONT_PRODUCT_COLUMNS, mapProductRow } from '../lib/storefront-row'
import { TOY_ADDONS, productKindOf, getGalleryImages } from '../lib/product-kind'
import { SHOP_PLACE } from '../config/business-info'
import type { Product } from '../types'
import ThreeDPrintRequestModal from '../components/ThreeDPrintRequestModal'
import './toyland.css'

const API_BASE = import.meta.env.VITE_API_BASE || 'https://api.imaginethisprinted.com'
const MEDIA = (modelId: string) => `${API_BASE}/api/media/3d-models/${modelId}/concept.png`
// Sir Barksalot, printed plain: the paint-kit story (a real print-ready model).
const BARKSALOT = '6b54089f-d328-4a6a-b567-e0db44713e03'

const addon = (id: string) => TOY_ADDONS.find((a) => a.id === id)
const MAGNET_PARTS = [
  { id: 'toy_weapon_pack', label: 'Weapon pack', icon: Sword },
  { id: 'toy_pet_companion', label: 'Pet companion', icon: PawPrint },
  { id: 'toy_magnet_pair', label: 'Extra magnets', icon: Magnet },
]

const STEPS = [
  { img: '/toys/step-1.webp', tone: 'toys-chip-purple', title: 'Dream it up', text: "Type or say your wildest idea in the Toy Maker. We draw it while you watch, and you change anything until it's perfect." },
  { img: '/toys/step-2.webp', tone: 'toys-chip-teal', title: 'We print it for real', text: 'Real 3D printers build your toy layer by layer in up to 4 bright colors. It shows up at your door ready to play.' },
  { img: '/toys/step-3.webp', tone: 'toys-chip-amber', title: 'Play, swap, paint', text: 'Snap weapons and pets onto its magnet hands, or paint your own with a matched paint kit.' },
]

/** A Toy Factory figurine: a 3D listing with a print3d record (the candle holder is 3D decor, not a toy). */
const isFigurine = (p: Product) => productKindOf(p) === '3d' && !!p.metadata?.print3d

const ToyLand: React.FC = () => {
  const [toys, setToys] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [showPrintRequestModal, setShowPrintRequestModal] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { data, error } = await applyStorefrontVisibility(
          supabase.from('products').select(STOREFRONT_PRODUCT_COLUMNS)
        )
          .or('category.ilike.%3d%,category.ilike.%toy%,metadata->>product_template.ilike.%3d%,metadata->>category.ilike.%3d%')
          .order('created_at', { ascending: false })
          .limit(24)
        if (error) throw error
        if (alive) setToys((data || []).map(mapProductRow).filter(isFigurine))
      } catch (err) {
        console.error('[ToyFactory] load failed:', err)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  // "Toys start at" is the cheapest real figurine, never a typed number.
  const fromPrice = useMemo(() => {
    const prices = toys.map((t) => t.price).filter((n) => n > 0)
    return prices.length ? Math.min(...prices) : null
  }, [toys])
  const paintKit = addon('toy_paint_kit')

  return (
    <div className="toys-root bg-bg">
      {/* HERO: the toy shop window */}
      <section className="relative overflow-hidden">
        <img src="/toys/hero.webp" alt="The Wizard Beast, Robo Rascal and Shadow Raptor toys on turntables" className="absolute inset-0 w-full h-full object-cover object-[75%_center]" width={1600} height={600} />
        <div className="absolute inset-0 toys-hero-fade" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-20 lg:py-24">
          <div className="max-w-lg">
            <p className="text-xs font-bold tracking-[0.16em] uppercase toys-accent-teal">3D Toy Factory</p>
            <p className="text-xs font-semibold tracking-[0.14em] uppercase text-white/70 mb-3">Printed in {SHOP_PLACE.town}, {SHOP_PLACE.stateCode}</p>
            <h1 className="font-display font-bold text-4xl sm:text-6xl text-white leading-[1.02] mb-4">
              Dream up a toy.
              <span className="block">We print it</span>
              <span className="block toys-accent-purple">for real.</span>
            </h1>
            <p className="text-white/85 text-base sm:text-lg leading-relaxed mb-7">
              Every toy here started as someone&apos;s idea and came off our printers as a full-color figure with magnets in its hands.
            </p>
            <div className="flex flex-wrap items-center gap-5">
              <Link to="/toy-creator" className="btn-primary">
                Make my toy <ArrowRight className="w-5 h-5" />
              </Link>
              <a href="#toys" className="text-sm font-semibold text-white underline underline-offset-4 decoration-white/40 hover:decoration-white">
                or meet the toys
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* HOW YOUR TOY GETS MADE */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-14 sm:pt-20">
        <p className="text-xs font-bold tracking-[0.16em] uppercase text-primary">How your toy gets made</p>
        <h2 className="font-display text-3xl sm:text-4xl text-text mt-1 mb-6 sm:mb-8">From your brain to your hands</h2>
        <ol className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5">
          {STEPS.map((s, i) => (
            <li key={s.title} className="bg-card rounded-2xl border border-border shadow-soft overflow-hidden flex flex-col">
              <img src={s.img} alt="" className="w-full aspect-[4/3] object-cover" loading="lazy" width={640} height={478} />
              <div className="p-5">
                <span className={`inline-flex w-8 h-8 rounded-full items-center justify-center text-sm font-bold text-white ${s.tone}`}>{i + 1}</span>
                <h3 className="font-display text-xl text-text mt-3 mb-1.5">{s.title}</h3>
                <p className="text-sm text-text-secondary leading-relaxed">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* MAGNET HANDS + PAINT YOUR OWN */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-14 sm:pt-20">
        <div className="rounded-3xl border border-border bg-bg-warm p-6 sm:p-10 grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
          <div>
            <p className="text-xs font-bold tracking-[0.16em] uppercase text-primary">Magnet hands</p>
            <h2 className="font-display text-3xl sm:text-4xl text-text mt-1 mb-3">Snap! New sword. Snap! Pet dragon.</h2>
            <p className="text-text-secondary leading-relaxed">
              Every figure hides tiny magnets in its palms, so extra parts click right into its hands. Collect them all:
            </p>
            <div className="flex flex-wrap gap-2.5 mt-4">
              {MAGNET_PARTS.map(({ id, label, icon: Icon }) => {
                const a = addon(id)
                return a ? (
                  <span key={id} className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-card border border-border text-sm font-semibold text-text">
                    <Icon className="w-4 h-4 text-primary" />
                    {label} <span className="text-primary">${a.price.toFixed(2)}</span>
                  </span>
                ) : null
              })}
            </div>

            <p className="text-xs font-bold tracking-[0.16em] uppercase text-primary mt-8">Paint your own</p>
            <h3 className="font-display text-2xl text-text mt-1 mb-2">The exact paints for YOUR toy</h3>
            <p className="text-text-secondary leading-relaxed">
              Order it plain and we pack a paint kit with the very colors your toy was designed in. Nothing missing, nothing extra.
            </p>
            <div className="flex flex-wrap items-center gap-3 mt-4">
              <span className="flex gap-2" aria-hidden="true">
                <span className="toys-pot toys-pot-red" />
                <span className="toys-pot toys-pot-yellow" />
                <span className="toys-pot toys-pot-teal" />
                <span className="toys-pot toys-pot-purple" />
              </span>
              {paintKit && (
                <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-card border border-border text-sm font-semibold text-text">
                  <Palette className="w-4 h-4 text-primary" />
                  Matched paint kit <span className="text-primary">${paintKit.price.toFixed(2)}</span>
                </span>
              )}
            </div>
          </div>
          <figure className="bg-card rounded-2xl border border-border shadow-soft-lg overflow-hidden max-w-sm w-full mx-auto">
            <img src={MEDIA(BARKSALOT)} alt="Sir Barksalot, an unpainted printed bulldog figure" className="w-full aspect-square object-cover" loading="lazy" />
            <figcaption className="px-5 py-4 font-display text-lg text-text">Sir Barksalot, printed plain and waiting for your paint</figcaption>
          </figure>
        </div>
      </section>

      {/* MEET THE TOYS */}
      <section id="toys" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-14 sm:pt-20 scroll-mt-20">
        <div className="relative overflow-hidden rounded-3xl">
          <img src="/toys/band.webp" alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
          <div className="absolute inset-0 toys-band-fade" />
          <div className="relative px-6 sm:px-10 py-8 sm:py-10">
            <p className="text-xs font-bold tracking-[0.16em] uppercase toys-accent-teal">Fresh off the printers</p>
            <h2 className="font-display text-3xl sm:text-4xl text-white mt-1 mb-2">Meet the toys</h2>
            <p className="text-white/85 max-w-xl">Real designs from our creator lab. Every one already has a print-ready 3D model waiting for the printer.</p>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-5 mt-5">
          {loading
            ? [0, 1, 2].map((i) => <div key={i} className="aspect-[3/4] rounded-2xl bg-border-subtle animate-pulse" />)
            : toys.map((toy) => {
                const palette = Array.isArray(toy.metadata?.print3d?.palette) ? (toy.metadata.print3d.palette as { hex: string }[]) : []
                return (
                  <Link key={toy.id} to={`/product/${toy.slug || toy.id}`} className="group bg-card rounded-2xl border border-border shadow-soft overflow-hidden flex flex-col hover:shadow-soft-lg transition-shadow">
                    <div className="aspect-square overflow-hidden bg-bg">
                      <img src={getGalleryImages(toy)[0] || toy.images?.[0]} alt={toy.altText || toy.name} className="w-full h-full object-contain transition-transform duration-500 group-hover:scale-105" loading="lazy" />
                    </div>
                    <div className="p-3 sm:p-4 flex flex-col gap-2 flex-1">
                      <h3 className="font-display text-base sm:text-lg text-text leading-snug">{toy.name.replace(/^Toy:\s*/i, '')}</h3>
                      <div className="flex items-center justify-between gap-2 mt-auto">
                        <span className="font-semibold text-primary">${toy.price.toFixed(2)}</span>
                        {palette.length > 0 && (
                          <span className="flex gap-1" aria-label="Print colors">
                            {palette.slice(0, 4).map((p, j) => (
                              <span key={j} className="w-3 h-3 rounded-full border border-black/10" style={{ backgroundColor: p.hex }} />
                            ))}
                          </span>
                        )}
                      </div>
                      <span className="inline-flex items-center justify-center gap-1.5 rounded-full bg-primary text-white text-sm font-semibold py-2 group-hover:opacity-90">
                        View toy <ArrowRight className="w-4 h-4" />
                      </span>
                    </div>
                  </Link>
                )
              })}
        </div>
      </section>

      {/* FOR GROWN-UPS */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-14 sm:pt-20">
        <div className="rounded-3xl border border-border bg-card shadow-soft p-6 sm:p-8">
          <p className="text-xs font-bold tracking-[0.16em] uppercase text-primary mb-4">For grown-ups</p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 text-sm">
            <li>
              <Leaf className="w-6 h-6 text-primary mb-2" strokeWidth={1.75} />
              <strong className="block text-text">Plant-based PLA plastic</strong>
              <span className="text-text-secondary">Printed in PLA, a rigid plant-based plastic.</span>
            </li>
            <li>
              <ShieldCheck className="w-6 h-6 text-primary mb-2" strokeWidth={1.75} />
              <strong className="block text-text">Magnets recessed and glued</strong>
              <span className="text-text-secondary">Small parts: always supervise children under 3.</span>
            </li>
            <li>
              <Store className="w-6 h-6 text-primary mb-2" strokeWidth={1.75} />
              <strong className="block text-text">Printed by us in {SHOP_PLACE.town}</strong>
              <span className="text-text-secondary">Made to order on our own printers, hand-finished before it ships.</span>
            </li>
            <li>
              <UserCheck className="w-6 h-6 text-primary mb-2" strokeWidth={1.75} />
              <strong className="block text-text">Kids design, grown-ups check out</strong>
              <span className="text-text-secondary">Kids design for free, no account needed. A grown-up's free account comes in when you mix the toy, and nothing prints until you order it.</span>
            </li>
          </ul>
          <p className="mt-6 pt-5 border-t border-border text-sm text-text-secondary flex items-center gap-2">
            <FileUp className="w-5 h-5 text-primary shrink-0" strokeWidth={1.75} />
            Have your own 3D file?
            <button className="font-semibold text-primary hover:underline underline-offset-4" onClick={() => setShowPrintRequestModal(true)}>
              Ask us for a print quote
            </button>
          </p>
        </div>
      </section>

      {/* CLOSING BAND */}
      <section className="relative overflow-hidden mt-14 sm:mt-20">
        <img src="/toys/band.webp" alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
        <div className="absolute inset-0 toys-close-fade" />
        <div className="relative max-w-3xl mx-auto px-4 py-14 sm:py-16 text-center">
          <h2 className="font-display text-3xl sm:text-5xl text-white mb-2">What will YOU make?</h2>
          {fromPrice !== null && <p className="text-white/85 mb-6">Toys start at ${fromPrice.toFixed(2)}.</p>}
          <Link to="/toy-creator" className="btn-primary">
            Make my toy <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </section>

      <ThreeDPrintRequestModal isOpen={showPrintRequestModal} onClose={() => setShowPrintRequestModal(false)} />
    </div>
  )
}

export default ToyLand
