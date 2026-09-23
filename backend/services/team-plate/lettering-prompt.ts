// Team plate — the edit prompt that redoes a name and number.
//
// David 2026-09-22: "just have gpt2.5 flare just redo the design keeping things
// intact and just redoin the name and number."
//
// PROMPT SCHEMA (pure, so it is pinned by tests and versioned by the cache):
//
//   1. ROLE      — what the image is (the back print of a team shirt).
//   2. CHANGE    — one line per template field: its label, the exact new value,
//                  the value SPELLED OUT character by character, and where it
//                  sits (as canvas percentages from the authored zone). An empty
//                  value becomes an instruction to remove that field cleanly.
//   3. STYLE     — reproduce the ORIGINAL lettering: typeface character, weight,
//                  outline layers, shadow, arch, distress, colours. The authored
//                  fill/stroke hexes ride along as a check, not as the source of
//                  truth — the pixels in the source image are.
//   4. FIT       — a longer or shorter value is re-spaced/scaled inside the same
//                  band. It never moves or rescales the art to make room.
//   5. HOLD      — everything else stays exactly as it is. No new text.
//
// There is no mask. The 2.5 edit endpoint regenerates the whole frame either
// way, and a mask drawn from the authored zones would be wrong the moment a
// longer surname needs a wider band than the sample had. What keeps the art
// intact is (5) plus the fact that the model is looking at it.
//
// Two modes, picked by what the template holds:
//   - 'replace': the source is the original art WITH the sample lettering, so
//     the style is shown, not described. The normal path.
//   - 'add':     only the erased plate exists (a template derived before
//     sourceAssetId was recorded), so the style has to be described from the
//     authored fields instead.
import type { TeamField, TeamTemplate } from '../../shared/team-template.js'

/**
 * Bump when the wording changes. It is part of the cache path, so a prompt
 * change re-generates on the next request instead of serving files the old
 * wording produced.
 */
export const LETTERING_PROMPT_VERSION = 1

export type LetteringMode = 'replace' | 'add'

function pct(n: number): number {
  return Math.round(n * 100)
}

/** 'SMITH' -> 'S-M-I-T-H'. A space is named, so "DE LA CRUZ" keeps its gaps. */
export function spellOut(value: string): string {
  return [...value].map((c) => (c === ' ' ? '(space)' : c)).join('-')
}

function placement(field: TeamField, canvas: { w: number; h: number }): string {
  const cx = pct((field.zone.x + field.zone.w / 2) / canvas.w)
  const cy = pct((field.zone.y + field.zone.h / 2) / canvas.h)
  const band = pct(field.zone.w / canvas.w)
  const shape = field.arch > 0 ? 'arched upward in a curve' : field.arch < 0 ? 'curved downward' : 'on a straight baseline'
  return `centred about ${cx}% across and ${cy}% down the artwork, spanning roughly ${band}% of its width, ${shape}`
}

function colours(field: TeamField): string {
  const parts = [`fill ${field.fill}`]
  if (field.strokes.length > 0) {
    parts.push(`outlined in ${field.strokes.map((s) => s.color).join(' then ')}`)
  }
  if (field.offset) parts.push(`with a hard offset shadow in ${field.offset.color}`)
  return parts.join(', ')
}

function fieldLine(field: TeamField, value: string, canvas: { w: number; h: number }, mode: LetteringMode): string {
  const what = field.type === 'number' ? 'player number' : field.label.toLowerCase()
  if (!value) {
    return mode === 'replace'
      ? `- The ${what}: REMOVE it completely and continue the surrounding artwork where it was, leaving no ghost or outline.`
      : `- The ${what}: leave that area as plain artwork — draw nothing there.`
  }
  const verb = mode === 'replace' ? 'must now read' : 'reads'
  return (
    `- The ${what} ${verb} exactly "${value}" ` +
    `(${value.length} character${value.length === 1 ? '' : 's'}: ${spellOut(value)}), ` +
    `${placement(field, canvas)}; colours ${colours(field)}.`
  )
}

/**
 * Build the edit prompt for one personalization.
 *
 * `values` must already be sanitized (sanitizeValues) — this is the only place
 * customer text meets a model, and the sanitizer is what limits it to
 * [A-Z0-9 '-] at a template-set length.
 */
export function buildLetteringPrompt(
  template: TeamTemplate,
  values: Record<string, string>,
  mode: LetteringMode
): string {
  const lines: string[] = []

  if (mode === 'replace') {
    lines.push(
      'This image is the finished back print of a team sports shirt. It carries a sample player name and number.',
      'Replace the name and the number with the ones below — and change NOTHING else.'
    )
  } else {
    lines.push(
      'This image is the back print of a team sports shirt with the player name and number left blank.',
      'Letter the name and number below onto it as bold team-jersey lettering — and change NOTHING else.'
    )
  }

  lines.push('', 'CHANGE:')
  for (const field of template.fields) {
    lines.push(fieldLine(field, values[field.key] ?? '', template.canvas, mode))
  }

  lines.push('', 'STYLE:')
  if (mode === 'replace') {
    lines.push(
      'Letter each new value in the SAME style the sample lettering uses: the same typeface character and weight,',
      'the same outline layers in the same order and thickness, the same shadow, the same arch or curve,',
      'and the same distressing, texture and wear. The colours listed above are what the sample uses — match the sample.'
    )
  } else {
    lines.push(
      'Use heavy athletic collegiate lettering in the colours listed above, with crisp outlines,',
      'and carry the artwork\'s own distressing and texture into the letters so they look printed with it.'
    )
  }

  lines.push(
    '',
    'FIT:',
    'If a new value is longer or shorter than the sample, re-space and scale the letters to sit in that same band.',
    'Never move, crop, shrink or redraw the artwork to make room.',
    '',
    'HOLD:',
    'Keep every other element exactly as it is: the mascot, logos, splatter, halftone dots, brush strokes, colours,',
    'composition, framing and background. Keep any transparent background transparent.',
    'Spell every character exactly as given, in the order given. Add no other text, no watermark, no signature.'
  )

  return lines.join('\n')
}
