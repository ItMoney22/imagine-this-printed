import { useEffect, useState } from 'react'
import { API_BASE } from './api'
import type { FeaturedOffer } from '../../backend/shared/seasonal-offer'

// One fetch per page load shared by the home banner and every product badge, so
// both read the same live discount_codes row the checkout validates.
let pending: Promise<FeaturedOffer | null> | null = null

function loadFeaturedOffer(): Promise<FeaturedOffer | null> {
  if (!pending) {
    pending = fetch(`${API_BASE}/api/coupons/featured`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => (d?.offer as FeaturedOffer | undefined) ?? null)
      .catch(() => null)
  }
  return pending
}

/** The live seasonal offer, or null when none is running. */
export function useFeaturedOffer(): FeaturedOffer | null {
  const [offer, setOffer] = useState<FeaturedOffer | null>(null)
  useEffect(() => {
    let alive = true
    loadFeaturedOffer().then(o => { if (alive) setOffer(o) })
    return () => { alive = false }
  }, [])
  return offer
}
