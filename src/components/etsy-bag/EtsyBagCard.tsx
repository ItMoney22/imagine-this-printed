import { Box, Gift, MapPin, Shirt, Sparkles, Layers } from 'lucide-react'
import { ETSY_BAG } from '../../../backend/shared/etsy-bag'

// The 4x6 thank-you card that goes in the bag (Watchtower task 8cde2a1d).
//
// Sized in container units (cqw = 1% of the card's width), so the same card
// is exactly 4in x 6in on paper and shrinks to fit a phone on screen. The
// wrapper decides the width; the card fills it at a 2:3 ratio.
//
// Etsy copy rule: the card pitches only what the Etsy shop does NOT sell
// (custom designs, 3D toys, blanks, DTF, local pickup), never "the same item
// cheaper on our site" — Etsy treats that as fee avoidance.

const ONLY_ON_OUR_SITE = [
  { icon: Sparkles, text: 'Design your own shirt in Imagination Station' },
  { icon: Box, text: '3D-printed toys' },
  { icon: Shirt, text: 'Blank tees for your projects' },
  { icon: Layers, text: 'DTF transfers to press at home' },
  { icon: MapPin, text: 'Free pickup in Rockmart, GA' }
]

export default function EtsyBagCard() {
  return (
    <div className="w-full [container-type:inline-size]">
      <article
        aria-label={`Thank-you card with code ${ETSY_BAG.code}`}
        className="relative flex aspect-[2/3] w-full flex-col overflow-hidden bg-card font-body text-text [print-color-adjust:exact] [-webkit-print-color-adjust:exact]"
      >
        <div className="h-[2.2cqw] w-full shrink-0 bg-gradient-to-r from-primary via-secondary to-accent" />

        <div className="flex flex-1 flex-col px-[6cqw] pb-[4.5cqw] pt-[4.5cqw]">
          {/* Thank-you */}
          <header className="flex items-center gap-[3cqw]">
            <img src="/mr-imagine-packing.png" alt="" className="w-[25cqw] shrink-0 rounded-[3cqw] object-cover ring-1 ring-border" />
            <div className="min-w-0">
              <p className="text-[2.8cqw] font-semibold uppercase tracking-[0.18em] text-primary">Imagine This Printed</p>
              <h2 className="mt-[1cqw] font-display text-[8.2cqw] font-bold leading-[1.05]">Thank you for your order!</h2>
              <p className="mt-[1.8cqw] text-[3.1cqw] leading-snug text-text-secondary">
                It means a lot to our small print shop in Rockmart, Georgia.
              </p>
            </div>
          </header>

          {/* The offer */}
          <section className="mt-[4.5cqw] rounded-[3cqw] border-[0.6cqw] border-dashed border-primary bg-bg-warm px-[4cqw] py-[3.2cqw] text-center">
            <p className="flex items-center justify-center gap-[1.5cqw] text-[3.6cqw] font-semibold">
              <Gift className="h-[4.2cqw] w-[4.2cqw] text-accent" aria-hidden />
              {ETSY_BAG.percentOff}% off your first order on our website
            </p>
            <p className="mt-[1.2cqw] font-display text-[12cqw] font-extrabold leading-none tracking-[0.08em] text-primary">
              {ETSY_BAG.code}
            </p>
            <p className="mt-[1.4cqw] text-[2.8cqw] text-muted">Enter the code at checkout. One use per customer.</p>
          </section>

          {/* What Etsy doesn't sell + QR */}
          <section className="mt-[4.5cqw] flex items-start gap-[4cqw]">
            <div className="min-w-0 flex-1">
              <p className="text-[3.4cqw] font-bold">Only on our website:</p>
              <ul className="mt-[2cqw] space-y-[2cqw]">
                {ONLY_ON_OUR_SITE.map(({ icon: Icon, text }) => (
                  <li key={text} className="flex items-start gap-[1.8cqw] text-[3.1cqw] leading-snug text-text-secondary">
                    <Icon className="mt-[0.3cqw] h-[3.6cqw] w-[3.6cqw] shrink-0 text-secondary" aria-hidden />
                    <span>{text}</span>
                  </li>
                ))}
              </ul>
            </div>
            <figure className="w-[33cqw] shrink-0 text-center">
              <img src={ETSY_BAG.qrImage} alt={`QR code to ${ETSY_BAG.displayUrl}`} className="w-full [image-rendering:pixelated]" />
              <figcaption className="mt-[0.8cqw] text-[2.8cqw] leading-tight">
                <span className="block font-semibold">Scan to start creating</span>
                <span className="block text-muted">{ETSY_BAG.displayUrl}</span>
              </figcaption>
            </figure>
          </section>

          {/* Footer */}
          <footer className="mt-auto border-t border-border pt-[2.6cqw] text-center text-[2.8cqw] text-muted">
            Questions? <span className="font-semibold text-text">wecare@imaginethisprinted.com</span>
          </footer>
        </div>
      </article>
    </div>
  )
}
