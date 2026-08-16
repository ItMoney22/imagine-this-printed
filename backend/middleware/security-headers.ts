// Security response headers for the API (helmet).
//
// This service answers JSON and binary assets only — it never serves an HTML
// page — so the CSP below is the API-appropriate lockdown ("this response is
// not a document; do not load anything from it, do not frame it, do not let a
// form post to it"). The browsing app's CSP lives in `vercel.json` and
// `server-static.mjs`, because those are what actually serve the SPA document.
//
// Two defaults are deliberately overridden:
//   - crossOriginResourcePolicy -> cross-origin. The SPA is served from
//     imaginethisprinted.com and loads generated mockups/designs from
//     api.imaginethisprinted.com. Helmet's same-origin default would block
//     those <img> loads.
//   - contentSecurityPolicy -> a minimal API policy instead of helmet's
//     document-shaped default.
import helmet from 'helmet'
import type { RequestHandler } from 'express'

// 1 year. Long enough to be meaningful, and the value browsers expect for an
// HTTPS-only API. Not `preload` — preloading is an apex-domain decision that
// has to be submitted deliberately, not a side effect of a backend deploy.
const HSTS_MAX_AGE_SECONDS = 31_536_000

export function securityHeaders(): RequestHandler {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'none'"],
        'base-uri': ["'none'"],
        'form-action': ["'none'"],
        'frame-ancestors': ["'none'"]
      }
    },
    // The API is fetched cross-origin by the SPA; CORS (configured in index.ts)
    // is the access control here, not CORP.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    // COEP would break cross-origin image/font loads for no benefit on a JSON API.
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'no-referrer' },
    hsts: {
      maxAge: HSTS_MAX_AGE_SECONDS,
      includeSubDomains: true,
      preload: false
    },
    // X-Frame-Options: DENY (belt-and-braces alongside frame-ancestors 'none',
    // which older browsers ignore).
    frameguard: { action: 'deny' },
    // X-Content-Type-Options: nosniff. A JSON body that a browser is allowed to
    // sniff as HTML is an XSS primitive.
    noSniff: true,
    // Strips X-Powered-By: Express.
    hidePoweredBy: true
  })
}
