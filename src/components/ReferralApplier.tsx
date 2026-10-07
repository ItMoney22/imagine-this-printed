import { useEffect } from 'react'
import { useAuth } from '../context/SupabaseAuthContext'
import { applyPendingReferral } from '../utils/referral-capture'

// Credits a friend's referral link (stored on landing by main.tsx) the first
// time an account is signed in on this device, then forgets it. The API
// decides whether the account may join through it; this only delivers it once.
// Renders nothing.
export default function ReferralApplier() {
  const { user } = useAuth()
  const userId = user?.id

  useEffect(() => {
    if (!userId) return
    void applyPendingReferral()
  }, [userId])

  return null
}
