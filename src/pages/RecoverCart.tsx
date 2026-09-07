// Where the "Finish My Order" button in the abandoned-cart email lands.
//
// The cart normally lives only in this browser's localStorage, so a recovery
// link that just pointed at /cart would be broken for anyone who reads email on
// their phone and shops on a laptop — which is most people. Instead this page
// asks the API for the cart snapshot the checkout draft already stored
// (GET /api/orders/:id/recover), writes it into the same localStorage key
// CartContext reads on mount, and then does a FULL page navigation to /checkout.
//
// The full navigation is deliberate: CartProvider reads localStorage exactly
// once, in a lazy useState initializer (src/context/CartContext.tsx). A
// client-side navigate() would leave the already-mounted provider holding the
// old, empty cart. Reloading the document is what makes the restore actually
// take — and it needs no change to CartContext, which is shared with other work.
import React, { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import { API_BASE } from '../lib/api'
import ProgressBar from '../components/studio/ProgressBar'

const CART_STORAGE_KEY = 'itp_cart_v1'
const COUPON_STORAGE_KEY = 'itp_cart_coupon_v1'

type Phase = 'restoring' | 'failed'

/** Plain-English failure text, keyed off the API's error code. */
const FAILURE_COPY: Record<string, { title: string; body: string }> = {
  already_paid: {
    title: 'You already completed this order',
    body: 'Good news — this one went through. Nothing else to do. You can check where it is from your order confirmation email.'
  },
  expired: {
    title: 'This cart link has expired',
    body: 'Cart links stay live for a week. Yours has passed that, so the prices and stock behind it are no longer reliable. Everything is still in the shop though.'
  },
  empty: {
    title: 'This cart is empty',
    body: 'There is nothing left to restore from that checkout.'
  },
  unavailable: {
    title: 'This cart is no longer available',
    body: 'The items in it have sold out or been retired. Have a look at what is in the shop now.'
  },
  invalid: {
    title: 'That link did not work',
    body: 'We could not verify this recovery link. It may have been cut short by your email app. Try copying the whole link, or just browse the shop.'
  },
  unknown: {
    title: 'We could not restore your cart',
    body: 'Something went wrong on our end. Nothing was charged. Try again in a moment, or email wecare@imaginethisprinted.com and we will sort it out.'
  }
}

const RecoverCart: React.FC = () => {
  const { orderId } = useParams<{ orderId: string }>()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('t')

  const [phase, setPhase] = useState<Phase>('restoring')
  const [failure, setFailure] = useState(FAILURE_COPY.unknown)
  const [startedAt] = useState(() => Date.now())
  // React 18 StrictMode double-invokes effects in dev. Restoring twice is
  // harmless (it's an overwrite, not an append) but redirecting twice is not.
  const ranRef = useRef(false)

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true

    const fail = (code: string) => {
      setFailure(FAILURE_COPY[code] || FAILURE_COPY.unknown)
      setPhase('failed')
    }

    if (!orderId || !token) {
      fail('invalid')
      return
    }

    const restore = async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/orders/${encodeURIComponent(orderId)}/recover?t=${encodeURIComponent(token)}`
        )
        const data = await res.json().catch(() => ({}))

        if (!res.ok) {
          fail(res.status === 403 ? 'invalid' : (data?.error || 'unknown'))
          return
        }
        if (!Array.isArray(data.items) || data.items.length === 0) {
          fail('empty')
          return
        }

        // Overwrite rather than merge. The email showed them a specific cart and
        // a specific total; silently adding to whatever is already in this
        // browser would hand them a different order than the one they clicked.
        window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ items: data.items }))
        if (data.couponCode) {
          try {
            window.localStorage.setItem(COUPON_STORAGE_KEY, JSON.stringify({ code: data.couponCode }))
          } catch {
            // A coupon that fails to restore is not worth failing the recovery
            // over — they can retype it at checkout.
          }
        }

        // Full document navigation, not navigate() — see the header comment.
        window.location.replace('/checkout?recovered=1')
      } catch (err) {
        console.error('[RecoverCart] Restore failed:', err)
        fail('unknown')
      }
    }

    restore()
  }, [orderId, token])

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-md text-center">
        {phase === 'restoring' ? (
          <>
            <h1 className="text-2xl font-bold text-text mb-2">Putting your cart back together</h1>
            <p className="text-muted text-sm mb-8">One moment — we are restoring exactly what you left behind.</p>
            <ProgressBar label="Restoring your cart" startedAt={startedAt} expectedMs={2500} />
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-text mb-3">{failure.title}</h1>
            <p className="text-muted text-sm leading-relaxed mb-8">{failure.body}</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                to="/catalog"
                className="inline-block bg-gradient-to-r from-purple-600 to-pink-600 text-white px-6 py-3 rounded-xl font-semibold shadow-lg shadow-purple-500/25"
              >
                Browse the shop
              </Link>
              <Link
                to="/cart"
                className="inline-block border border-purple-500/30 text-text px-6 py-3 rounded-xl font-semibold hover:bg-purple-500/5"
              >
                Go to my cart
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default RecoverCart
