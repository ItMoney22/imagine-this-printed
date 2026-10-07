import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { API_BASE } from '../lib/api'
import type { FeaturedOffer } from '../../backend/shared/seasonal-offer'

/** Last day the offer works, in the shopper's own words, e.g. "October 31". */
export function offerEndLabel(endsAt: string): string {
  // expires_at is set to 11:59pm Eastern on the final day, so that day is the label.
  return new Date(endsAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'America/New_York' })
}

/** Home banner. Renders only while the live coupon behind it is valid. */
export default function SeasonalOfferBanner() {
  const [offer, setOffer] = useState<FeaturedOffer | null>(null)

  useEffect(() => {
    let alive = true
    fetch(`${API_BASE}/api/coupons/featured`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (alive && d?.offer) setOffer(d.offer) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  if (!offer) return null
  const min = offer.minOrderAmount ? ` on orders of $${offer.minOrderAmount} or more` : ''
  return (
    <div className="bg-primary text-bg" role="region" aria-label="Seasonal offer">
      <div className="mx-auto max-w-6xl px-4 py-2 text-center text-sm font-semibold">
        {offer.percentOff}% off{min} with code {offer.code} at checkout. Ends {offerEndLabel(offer.endsAt)}.{' '}
        <Link to="/products" className="underline">Shop now</Link>
      </div>
    </div>
  )
}
