// A store's discount codes (David 2026-10-26, Crystal's store: "she should be able to give a discount to her
// peeps but whatever she does cuts at her own cost"). She makes them in her store manager
// (routes/vendor-store-discounts.ts); buyers type one in the cart (routes/vendor-store.ts). What a code takes
// off, and the rule that it only ever comes out of her share, is lib/vendor-store-split.ts. These are the
// plain rules for the code itself. Dependency-free so the test imports it plainly.

export type DiscountKind = 'percent' | 'amount'

export type DiscountCodeRow = {
  id: string
  storefront_id: string
  code: string
  kind: DiscountKind
  /** percent: 1..100. amount: cents off. */
  amount: number
  /** The last day the code works (store time), or null for no end date. */
  ends_on: string | null
  active: boolean
  created_at?: string
}

export const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,23}$/
const MAX_AMOUNT_OFF_CENTS = 100000

/** Codes are matched without caring about case or spaces: "crystal 20" is CRYSTAL20. */
export const normalizeCode = (v: unknown): string => String(v ?? '').toUpperCase().replace(/\s+/g, '')

/** Today in the store's time (Eastern, where ITP is). An end date is the last day a code works. */
export function storeToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** "20% off" / "$5.00 off", the way she and the buyer read it. */
export const codeLabel = (c: Pick<DiscountCodeRow, 'kind' | 'amount'>): string =>
  c.kind === 'percent' ? `${c.amount}% off` : `$${(c.amount / 100).toFixed(2)} off`

/** Why a buyer can't use this code right now, in words for the buyer; null when it works. */
export function codeRefusal(row: DiscountCodeRow | null, today = storeToday()): string | null {
  if (!row) return 'We don’t know that code. Check the spelling and try again.'
  if (!row.active) return `${row.code} is switched off right now.`
  if (row.ends_on && row.ends_on < today) {
    const ended = new Date(`${row.ends_on}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    return `${row.code} ended on ${ended}.`
  }
  return null
}

type CodeFields = Pick<DiscountCodeRow, 'code' | 'kind' | 'amount' | 'ends_on' | 'active'>

/**
 * Her create or edit form. A new code needs code, kind and amount; an edit sends only what changed and is checked
 * against the code as it is now (`current`), so switching percent to dollars re-checks the amount.
 */
export function readDiscountInput(
  body: Record<string, unknown> | null | undefined,
  current: CodeFields | null = null,
  today = storeToday()
): { fields: Partial<CodeFields> } | { problem: string } {
  const b = body || {}
  const fields: Partial<CodeFields> = {}

  if (b.code !== undefined || !current) {
    const code = normalizeCode(b.code)
    if (!CODE_PATTERN.test(code)) return { problem: 'A code is 3 to 24 letters or numbers (a dash is fine), like CRYSTAL20.' }
    fields.code = code
  }
  if (b.kind !== undefined || !current) {
    if (b.kind !== 'percent' && b.kind !== 'amount') return { problem: 'Pick percent off or dollars off.' }
    fields.kind = b.kind
  }
  if (b.amount !== undefined || !current || (fields.kind && fields.kind !== current.kind)) {
    const kind = fields.kind ?? current!.kind
    const amount = Number(b.amount ?? (fields.kind ? undefined : current?.amount))
    if (kind === 'percent' && !(Number.isInteger(amount) && amount >= 1 && amount <= 100)) return { problem: 'Percent off is a whole number from 1 to 100.' }
    if (kind === 'amount' && !(Number.isInteger(amount) && amount >= 100 && amount <= MAX_AMOUNT_OFF_CENTS)) return { problem: 'Dollars off is at least $1.00.' }
    fields.amount = amount
  }
  if (b.endsOn !== undefined) {
    if (b.endsOn === null || b.endsOn === '') fields.ends_on = null
    else {
      const d = String(b.endsOn)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) return { problem: 'That end date doesn’t look right.' }
      if (d < today) return { problem: 'Pick an end date from today on.' }
      fields.ends_on = d
    }
  } else if (!current) fields.ends_on = null
  if (b.active !== undefined) {
    if (typeof b.active !== 'boolean') return { problem: 'On or off?' }
    fields.active = b.active
  } else if (!current) fields.active = true

  return { fields }
}
