// Guests can open every tool and info page; an account is asked for only at
// the step that saves something or spends money (David via Zero Nine's
// logged-out walk, 2026-10-07, task 8c67fe67). Every "why do you need an
// account" line on the site lives here, so the modal, the sign-in page and the
// sign-up page always say the same thing.

export type GuestGateReason =
  | 'toy-mix'
  | 'toy-voice'
  | 'studio-imagine'
  | 'studio-edit'
  | 'studio-save'
  | 'studio-order'
  | 'metal-create'
  | 'community-vote'
  | 'community-boost'
  | 'community-submit'
  | 'wholesale-apply'
  | 'referral-link'

export interface GuestGateCopy {
  /** Headline: what the account unlocks, in the customer's words. */
  title: string
  /** One sentence: why this step needs an account. */
  why: string
  /** Optional reassurance about the work they already did. */
  keep?: string
}

export const GUEST_GATE_COPY: Record<GuestGateReason, GuestGateCopy> = {
  'toy-mix': {
    title: 'Make a free account to mix your toy',
    why: 'Mixing draws your creature and keeps it in your account, so you can come back to it and order the print.',
    keep: 'Your picks stay right here while you sign up.',
  },
  'toy-voice': {
    title: 'Make a free account to talk to Mr. Imagine',
    why: 'Mr. Imagine listens on our servers, so talking needs an account. You can type your idea in the box below without one.',
  },
  'studio-imagine': {
    title: 'Make a free account to imagine a design',
    why: 'New designs are drawn on our servers and saved to your account. New accounts get free tries to start.',
    keep: 'Anything you placed on your sheet stays on this screen while you look around.',
  },
  'studio-edit': {
    title: 'Make a free account to use this tool',
    why: 'Editing tools run on our servers and save the result to your account.',
  },
  'studio-save': {
    title: 'Make a free account to save your sheet',
    why: 'Saving keeps your sheet in your account so you can come back to it and order prints.',
  },
  'studio-order': {
    title: 'Make a free account to order your sheet',
    why: 'We save your sheet to your account to make its print file and to track your order.',
  },
  'metal-create': {
    title: 'Make a free account to create your art',
    why: 'Your artwork is made on our servers and kept in your account until you order your print.',
  },
  'community-vote': {
    title: 'Make a free account to vote',
    why: 'One account, one vote, so the leaderboard stays fair.',
  },
  'community-boost': {
    title: 'Make a free account to boost a post',
    why: 'Boosts are paid from your wallet, so they need an account.',
  },
  'community-submit': {
    title: 'Make a free account to share your creation',
    why: 'Posts are tied to an account so we can credit you and reach you if it gets featured.',
  },
  'wholesale-apply': {
    title: 'Make a free account to apply',
    why: 'Your application and your wholesale prices live on your account, so approved prices show up whenever you sign in.',
  },
  'referral-link': {
    title: 'Make a free account to get your link',
    why: 'Your personal link is tied to your account, so the rewards land in your wallet.',
  },
}

export function isGuestGateReason(value: unknown): value is GuestGateReason {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(GUEST_GATE_COPY, value)
}

// Pages that are genuinely private (your orders, your wallet, the dashboards)
// still redirect to sign-in. This names what the visitor was trying to open so
// that wall is never a bare form.
const SIGN_IN_PLACES: Array<{ prefix: string; place: string }> = [
  { prefix: '/account/orders', place: 'your orders' },
  { prefix: '/account/designs', place: 'your saved designs' },
  { prefix: '/my-designs', place: 'your saved designs' },
  { prefix: '/account/messages', place: 'your messages' },
  { prefix: '/account/media', place: 'your uploads' },
  { prefix: '/account', place: 'your account' },
  { prefix: '/wallet', place: 'your wallet' },
  { prefix: '/become-creator', place: 'the creator program' },
  { prefix: '/creator', place: 'your creator studio' },
]

/** "Sign in to see your orders." — or null when the path needs no explanation. */
export function signInReasonFor(pathname: string | null | undefined): string | null {
  if (!pathname) return null
  const hit = SIGN_IN_PLACES.find(({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  if (!hit) return null
  return `Sign in to see ${hit.place}. They're private to your account.`
}

/** Where AuthCallback sends someone after they confirm their email. */
export const AUTH_RETURN_KEY = 'auth_return_to'

export function rememberReturnPath(path: string): void {
  try {
    localStorage.setItem(AUTH_RETURN_KEY, path)
  } catch {
    // Private mode / blocked storage: sign-in still works, it just lands home.
  }
}

/** The banner text the sign-in and sign-up pages show for a visitor sent there. */
export function gateBannerFor(state: unknown): GuestGateCopy | null {
  if (!state || typeof state !== 'object') return null
  const s = state as { reason?: unknown; from?: { pathname?: unknown } }
  if (isGuestGateReason(s.reason)) return GUEST_GATE_COPY[s.reason]
  const pathname = typeof s.from?.pathname === 'string' ? s.from.pathname : null
  const why = signInReasonFor(pathname)
  return why ? { title: 'This page is private', why } : null
}
