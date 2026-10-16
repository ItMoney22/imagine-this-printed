import { Link } from 'react-router-dom'
import { useFeaturedOffer } from '../lib/featured-offer'

/** Last day the offer works, in the shopper's own words, e.g. "October 31". */
export function offerEndLabel(endsAt: string): string {
  // expires_at is set to 11:59pm Eastern on the final day, so that day is the label.
  return new Date(endsAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'America/New_York' })
}

/** Home banner. Renders only while the live coupon behind it is valid. */
export default function SeasonalOfferBanner() {
  const offer = useFeaturedOffer()
  if (!offer) return null
  const min = offer.minOrderAmount ? ` on orders of $${offer.minOrderAmount} or more` : ''
  // A themed code only covers those designs, so the banner says which.
  const theme = offer.theme ? offer.theme.charAt(0).toUpperCase() + offer.theme.slice(1) : null
  return (
    <div className="bg-primary text-bg" role="region" aria-label="Seasonal offer">
      <div className="mx-auto max-w-6xl px-4 py-2 text-center text-sm font-semibold">
        {offer.percentOff}% off{theme ? ` ${theme} designs` : ''}{min} with code {offer.code} at checkout. Ends {offerEndLabel(offer.endsAt)}.{' '}
        {/* /catalog, not /products: that path is a 404, which is where this link
            sent every shopper from 10/13 to 10/16. */}
        <Link to={theme ? `/catalog?q=${encodeURIComponent(offer.theme!)}` : '/catalog'} className="underline">
          {theme ? `Shop ${theme}` : 'Shop now'}
        </Link>
      </div>
    </div>
  )
}
