import { Gift, Heart, MessageCircle, Search } from 'lucide-react'
import { ETSY_BAG_CARD } from '../../../backend/shared/etsy-bag'

// The 4x6 thank-you card that goes in the Etsy bag (Watchtower tasks
// 8cde2a1d, d9a98efc).
//
// Sized in container units (cqw = 1% of the card's width), so the same card
// is exactly 4in x 6in on paper and shrinks to fit a phone on screen. The
// wrapper decides the width; the card fills it at a 2:3 ratio.
//
// Etsy rule (Off-Platform Transactions Policy, updated 2026-10-05): nothing on
// this card may point an Etsy buyer off Etsy — no website discount, no QR, no
// website, no off-Etsy contact. The offer is an Etsy SHOP promo code, and
// every "come back" line points at the Etsy shop. Keep it that way.

const BACK_ON_ETSY = [
  { icon: Heart, text: 'Favorite our shop on Etsy to see new designs first' },
  { icon: Search, text: `Find us anytime: search ${ETSY_BAG_CARD.etsyShopName} on Etsy` },
  { icon: MessageCircle, text: 'Questions about your order? Message us on Etsy' }
]

export interface EtsyBagCardProps {
  /** The Etsy shop promo code and its percent off; null shows an empty code slot (preview only). */
  coupon: { code: string; percentOff: number } | null
}

export default function EtsyBagCard({ coupon }: EtsyBagCardProps) {
  return (
    <div className="w-full [container-type:inline-size]">
      <article
        aria-label={coupon ? `Thank-you card with Etsy code ${coupon.code}` : 'Thank-you card, Etsy code not set yet'}
        className="relative flex aspect-[2/3] w-full flex-col overflow-hidden bg-card font-body text-text [print-color-adjust:exact] [-webkit-print-color-adjust:exact]"
      >
        <div className="h-[2.2cqw] w-full shrink-0 bg-gradient-to-r from-primary via-secondary to-accent" />

        <div className="flex flex-1 flex-col px-[6cqw] pb-[4.5cqw] pt-[4.5cqw]">
          <div className="flex flex-1 flex-col justify-around gap-[4cqw]">
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

            {/* The offer: an Etsy shop code for the next Etsy order */}
            <section className="rounded-[3cqw] border-[0.6cqw] border-dashed border-primary bg-bg-warm px-[4cqw] py-[5cqw] text-center">
              <p className="flex items-center justify-center gap-[1.5cqw] text-[3.6cqw] font-semibold">
                <Gift className="h-[4.2cqw] w-[4.2cqw] text-accent" aria-hidden />
                {coupon ? `${coupon.percentOff}% off your next order in our Etsy shop` : 'Your Etsy shop offer goes here'}
              </p>
              {coupon ? (
                <p className="mt-[2cqw] break-all font-display text-[10.5cqw] font-extrabold leading-none tracking-[0.06em] text-primary lining-nums">
                  {coupon.code}
                </p>
              ) : (
                <p className="mx-auto mt-[1.4cqw] w-[70%] rounded-[2cqw] border-[0.4cqw] border-dashed border-muted py-[2.4cqw] text-[3.4cqw] font-semibold text-muted">
                  Etsy code not set yet
                </p>
              )}
              <p className="mt-[2.2cqw] text-[2.9cqw] text-muted">Enter the code at checkout in our Etsy shop.</p>
            </section>

            {/* Come back — on Etsy */}
            <section>
              <p className="text-[3.8cqw] font-bold">See you again on Etsy</p>
              <ul className="mt-[2.6cqw] space-y-[3cqw]">
                {BACK_ON_ETSY.map(({ icon: Icon, text }) => (
                  <li key={text} className="flex items-start gap-[2.2cqw] text-[3.4cqw] leading-snug text-text-secondary">
                    <Icon className="mt-[0.3cqw] h-[4cqw] w-[4cqw] shrink-0 text-secondary" aria-hidden />
                    <span>{text}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          {/* Brand line */}
          <footer className="mt-[4cqw] border-t border-border pt-[2.6cqw] text-center text-[2.8cqw] text-muted">
            Made with care by <span className="font-semibold text-text">Imagine This Printed</span> · Rockmart, Georgia
          </footer>
        </div>
      </article>
    </div>
  )
}
