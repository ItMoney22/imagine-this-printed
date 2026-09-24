// Spelling verdict for lettering renders (Flare Lab Text Swap, Team Studio proofs).
import React from 'react'
import type { LetteringVerdict } from '../../../lib/api'

/** The spelling verdict under a lettering result — green, red, or honestly unverified. */
export const SpellingBadge: React.FC<{ verdict: LetteringVerdict | null | undefined; expected: string[]; attempts?: number }> = ({
  verdict,
  expected,
  attempts,
}) => {
  if (verdict === undefined) return null
  if (verdict === null) {
    return <p className="text-[11px] text-amber-400">Spelling not verified (checker unavailable) — read every letter yourself.</p>
  }
  if (verdict.ok) {
    return (
      <p className="text-[11px] text-emerald-400">
        ✓ Spelling checked letter by letter: {expected.map((e) => `“${e}”`).join(' + ')}
        {attempts && attempts > 1 ? ' (first render was misspelled and was redrawn)' : ''}
      </p>
    )
  }
  return (
    <p className="text-[11px] text-red-400 font-medium">
      ✗ Misspelled —{' '}
      {verdict.mismatches.map((m) => `reads “${m.closest ?? '?'}”, should be “${m.expected}”`).join('; ')}. Render it again.
    </p>
  )
}
