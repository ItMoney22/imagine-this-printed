import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { trackPageView } from '../utils/analytics'

/** Fires one GA4 page_view per route change. Renders nothing. */
export default function AnalyticsTracker() {
  const { pathname, search } = useLocation()
  useEffect(() => {
    trackPageView(pathname + search)
  }, [pathname, search])
  return null
}
