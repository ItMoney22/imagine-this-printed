// Team plate — flagging a personalization for human review.
//
// This FLAGS, it never refuses. That distinction is the whole design:
//
//   - A child genuinely named Dick, Gay, Wang or Cummings must not hit an error
//     at the till. Refusing them is both wrong and, on a kids' sports shirt,
//     humiliating in a way the customer will remember.
//   - Equally, a shirt reading something a parent did not intend should not go
//     through the press unseen.
//
// So an order still completes, the values are still recorded, and the line
// carries a reason the team can glance at before pressing. The judgement stays
// with a person, which is where it belongs — a word list cannot tell a surname
// from an insult, and pretending otherwise just moves the mistake.
import type { TeamTemplate } from '../../shared/team-template.js'

/**
 * Substrings that warrant a look. Deliberately short and blunt: a long list
 * produces so many false positives on real surnames that the flag stops being
 * read at all, which is worse than no flag.
 */
const REVIEW_TERMS = [
  'fuck', 'shit', 'cunt', 'bitch', 'nigg', 'fagg', 'rape', 'nazi', 'hitler',
  'whore', 'slut', 'penis', 'vagina', 'anal', 'porn',
]

/**
 * Trademarks that show up on sports shirts and are not ours to print.
 * The Etsy copyright gate covers generated artwork; this covers the one string
 * a customer types themselves.
 */
const TRADEMARK_TERMS = [
  'nike', 'adidas', 'gucci', 'disney', 'marvel', 'nfl', 'nba', 'mlb', 'espn',
  'supreme', 'yeezy',
  // Deliberately NOT here: JORDAN. On a jersey the name field holds a
  // surname, and Jordan is one of the commonest there is - flagging it would
  // cost a real order for every imaginary trademark it caught.
]

export interface ReviewFlag {
  field: string
  reason: string
}

/** Collapse leetspeak and separators so F.U.C.K and SH1T still register. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/@/g, 'a')
}

/**
 * Reasons this personalization deserves a human look before it is pressed.
 *
 * An empty array means nothing stood out — NOT that it was approved.
 */
export function reviewFlags(
  template: TeamTemplate,
  values: Record<string, string>
): ReviewFlag[] {
  const flags: ReviewFlag[] = []
  for (const field of template.fields) {
    const raw = values[field.key] ?? ''
    if (!raw) continue
    const norm = normalize(raw)

    for (const term of REVIEW_TERMS) {
      if (norm.includes(term)) {
        flags.push({ field: field.key, reason: `contains "${term}" — check before pressing` })
        break
      }
    }
    for (const term of TRADEMARK_TERMS) {
      if (norm === term) {
        // Whole-value match only: someone called JORDAN is extremely common and
        // is not a trademark problem; a shirt that just says NIKE is.
        flags.push({ field: field.key, reason: `reads "${raw}" — possible trademark` })
        break
      }
    }
  }
  return flags
}
