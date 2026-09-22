import React, { useEffect, useRef, useState } from 'react'
import {
  TURNSTILE_SITE_KEY,
  TURNSTILE_SCRIPT_SRC,
  isCaptchaConfigured,
  type CaptchaAction,
} from '../lib/captcha'

/**
 * Renders the Cloudflare Turnstile challenge and hands the resulting token up.
 *
 * Deliberately has no npm dependency. A wrapper package would be a third party
 * sitting in the login path of an e-commerce site for the sake of ~60 lines,
 * and the explicit-render API below is the same one the wrapper calls.
 *
 * Renders nothing when VITE_TURNSTILE_SITE_KEY is unset — see src/lib/captcha.ts
 * for why that fail-open is a deploy-ordering choice and not a security one.
 */

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string | undefined
      reset: (id?: string) => void
      remove: (id?: string) => void
    }
    onloadTurnstileCallback?: () => void
  }
}

/** Module-level so N widgets on a page still share one <script> tag. */
let scriptPromise: Promise<void> | null = null

function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve()
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${TURNSTILE_SCRIPT_SRC}"]`
    )
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('Turnstile script failed to load')))
      return
    }

    const script = document.createElement('script')
    script.src = TURNSTILE_SCRIPT_SRC
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => {
      // Let a later mount retry rather than caching the failure forever.
      scriptPromise = null
      reject(new Error('Turnstile script failed to load'))
    }
    document.head.appendChild(script)
  })

  return scriptPromise
}

interface TurnstileWidgetProps {
  /** Fires with a token on success, and with null when it expires or errors. */
  onVerify: (token: string | null) => void
  /** Tags the solve in Cloudflare's analytics so floods are attributable. */
  action: CaptchaAction
  /**
   * Bump this to force a fresh challenge. A token is single-use: after a failed
   * submit the old one is spent, so the next attempt needs a new one.
   */
  resetSignal?: number
  className?: string
}

const TurnstileWidget: React.FC<TurnstileWidgetProps> = ({
  onVerify,
  action,
  resetSignal = 0,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)
  const onVerifyRef = useRef(onVerify)
  const [loadFailed, setLoadFailed] = useState(false)

  // Keep the latest callback without making it a render dependency — a new
  // function identity each render would otherwise tear down and re-render the
  // challenge on every keystroke in the form.
  useEffect(() => {
    onVerifyRef.current = onVerify
  }, [onVerify])

  useEffect(() => {
    if (!isCaptchaConfigured()) return

    let cancelled = false

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return
        if (widgetIdRef.current !== null) return

        widgetIdRef.current =
          window.turnstile.render(containerRef.current, {
            sitekey: TURNSTILE_SITE_KEY,
            action,
            theme: 'auto',
            callback: (token: string) => onVerifyRef.current(token),
            'expired-callback': () => onVerifyRef.current(null),
            'timeout-callback': () => onVerifyRef.current(null),
            'error-callback': () => {
              onVerifyRef.current(null)
              return true // keep the widget mounted so the user can retry
            },
          }) ?? null
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true)
      })

    return () => {
      cancelled = true
      if (widgetIdRef.current !== null && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current)
        } catch {
          // Turnstile throws if the widget is already gone; nothing to do.
        }
      }
      widgetIdRef.current = null
    }
    // `action` is a literal at every call site, so this runs once per mount.
  }, [action])

  useEffect(() => {
    if (resetSignal === 0) return
    if (widgetIdRef.current !== null && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current)
      onVerifyRef.current(null)
    }
  }, [resetSignal])

  if (!isCaptchaConfigured()) return null

  if (loadFailed) {
    return (
      <p className={`text-sm text-muted ${className}`.trim()}>
        The security check could not load. Disable any content blocker for this
        page and refresh to continue.
      </p>
    )
  }

  return <div ref={containerRef} className={className} />
}

export default TurnstileWidget
