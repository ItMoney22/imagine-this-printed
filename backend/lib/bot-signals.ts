// Signup-bot fingerprints, shared by the admin "Scan for bot signups" panel
// (routes/admin/users.ts) and the worker's automatic sweep
// (worker/signup-bot-sweep.ts). See the header in routes/admin/users.ts for
// where each tell came from.

/** Names a generator produced: too few vowels, or a 4+ consonant run. */
export function looksGenerated(name?: string | null): boolean {
  if (!name) return false
  const t = name.toLowerCase().replace(/[^a-z]/g, '')
  if (t.length < 4) return false
  const vowels = (t.match(/[aeiou]/g) || []).length
  const longestConsonantRun = Math.max(0, ...t.split(/[aeiou]/).map(s => s.length))
  return vowels / t.length < 0.28 || longestConsonantRun >= 4
}

/** Gmail ignores dots, so 3+ of them is address mutation, not a real address. */
export function looksDotInjected(email?: string | null): boolean {
  const local = (email || '').split('@')[0]
  return (local.match(/\./g) || []).length >= 3
}

export type BotSignal = { score: number; reasons: string[] }

// The signals are not equally strong, so they are weighted rather than counted.
// A generated name or a dot-injected address is near-conclusive on its own (a
// real person is not called "Xbdwnbbi Wwmeye") and scores 2; dormancy is
// suggestive but innocent on its own — plenty of real people sign up and never
// come back — so it scores 1. At the default threshold of 3 that means every
// flagged account has at least one conclusive tell plus corroboration, and no
// amount of mere dormancy can flag a real account on its own.
const STRONG = 2
const WEAK = 1

export function scoreAccount(u: any): BotSignal {
  const reasons: string[] = []
  const meta = u.user_metadata || {}
  let score = 0

  if (looksGenerated(meta.first_name) || looksGenerated(meta.last_name)) {
    reasons.push('machine-generated name')
    score += STRONG
  }
  if (looksDotInjected(u.email)) {
    reasons.push('dot-injected email local part')
    score += STRONG
  }
  if (!u.last_sign_in_at) {
    reasons.push('never signed in')
    score += WEAK
  }
  if (!u.email_confirmed_at && !u.confirmed_at) {
    reasons.push('email never confirmed')
    score += WEAK
  }
  return { score, reasons }
}

