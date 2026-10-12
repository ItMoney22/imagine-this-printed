import { useEffect, useRef } from 'react'
import { useAuth } from '../context/SupabaseAuthContext'
import { useCart } from '../context/CartContext'
import { useToastContext } from '../context/ToastContext'
import {
  applyPendingReferral,
  fetchWelcomeCode,
  markWelcomeOffered,
  wasWelcomeOffered,
} from '../utils/referral-capture'

// Credits a friend's referral link (stored on landing by main.tsx) the first
// time an account is signed in on this device, then forgets it. The API
// decides whether the account may join through it; this only delivers it once.
//
// Joining through a link gives the friend a personal 10%-off first-order code
// (task 4cebbf83). Once there is something in the cart and no other code on
// it, this asks the API for that code and puts it in the cart, once per code
// per device. Renders nothing.
export default function ReferralApplier() {
  const { user } = useAuth()
  const { state, appliedCoupon, applyCoupon } = useCart()
  const { addToast } = useToastContext()
  const userId = user?.id
  const hasItems = state.items.length > 0
  // One welcome-code lookup per account per visit.
  const checkedFor = useRef<string | null>(null)

  useEffect(() => {
    if (!userId) return
    void applyPendingReferral()
  }, [userId])

  useEffect(() => {
    if (!userId || !hasItems || appliedCoupon || checkedFor.current === userId) return
    checkedFor.current = userId
    void (async () => {
      // A link being applied right now mints the code first.
      await applyPendingReferral()
      const welcome = await fetchWelcomeCode()
      if (!welcome || wasWelcomeOffered(welcome.code)) return
      const result = await applyCoupon(welcome.code, userId)
      if (!result.success) return
      markWelcomeOffered(welcome.code)
      addToast({
        type: 'success',
        title: `${welcome.percent}% off your first order`,
        // One line on a phone (Toast truncates): the cart page shows no codes,
        // checkout does.
        message: 'Comes off at checkout. Thanks to a friend!',
      })
    })()
  }, [userId, hasItems, appliedCoupon, applyCoupon, addToast])

  return null
}
