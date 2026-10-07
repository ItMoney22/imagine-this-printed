// ---------------------------------------------------------------------------
// GA4 loader. Free tier, one property, measurement id from
// VITE_GA4_MEASUREMENT_ID (G-XXXXXXX). With no id the whole module is a no-op,
// so the build is safe before the property exists and in local dev.
//
// Loaded by injecting the gtag.js script at runtime — vercel.json's CSP
// already allows googletagmanager.com / google-analytics.com, and a runtime
// injection needs no inline script. The router is a SPA, so the automatic
// page_view is turned off and trackPageView() fires one per route change.
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: (...args: unknown[]) => void
  }
}

const MEASUREMENT_ID = (import.meta.env.VITE_GA4_MEASUREMENT_ID as string | undefined)?.trim() || ''

let initialised = false

export function isAnalyticsEnabled(): boolean {
  return /^G-[A-Z0-9]+$/.test(MEASUREMENT_ID)
}

export function initAnalytics(): void {
  if (initialised || typeof window === 'undefined' || !isAnalyticsEnabled()) return
  initialised = true

  window.dataLayer = window.dataLayer || []
  // gtag.js reads the dataLayer entries as Arguments objects, not arrays.
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments)
  }
  window.gtag('js', new Date())
  window.gtag('config', MEASUREMENT_ID, { send_page_view: false })

  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(MEASUREMENT_ID)}`
  document.head.appendChild(script)
}

export function trackPageView(path: string): void {
  if (!isAnalyticsEnabled() || !window.gtag) return
  window.gtag('event', 'page_view', {
    page_path: path,
    page_location: window.location.href,
    page_title: document.title
  })
}
