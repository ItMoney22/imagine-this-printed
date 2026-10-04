// Prompt-sensitivity refusals, and what to do about them.
//
// Every image engine in the flow can refuse a prompt on content grounds rather
// than fail technically. Replicate answers with error code **E005** ("Requested
// content is flagged as sensitive"), OpenAI with "rejected as a result of our
// safety system" / content_policy_violation, Imagen with its own safety-filter
// text. The repo already documents how often this is a FALSE positive on
// perfectly sellable designs — see the FANOUT_EXCLUDE note in
// backend/services/image-flow/worker-helpers.ts: Imagen 4 Ultra was pulled out
// of the design fan-out entirely because benign briefs (mascots, "roaring",
// athletic themes) were being flagged, and "a deterministic pick killed half of
// every batch".
//
// Before this module, a refusal reached the admin as a *blank Design step* with
// the generic "No design on this product yet" card: the real reason was sitting
// in `ai_jobs.error` and was never rendered. The only recovery was to guess
// which word offended and retype the brief.
//
// Nothing here claims to know an engine's policy. `softenPrompt` swaps a small,
// documented vocabulary of known trigger words for tamer wording that keeps the
// design intent, reports EVERY swap it made so the admin can see exactly what
// changed, and is always presented as an editable suggestion — never applied
// silently and never described as guaranteed to pass.

/** One documented trigger → the replacement, and why it's in the list. */
interface Swap {
  /** Alternatives, matched word-bounded and case-insensitively. */
  words: string[]
  /** Replacement wording, or '' to drop the word (and a comma right after it). */
  to: string
  /** Shown in the UI next to the swap so the change is never a black box. */
  why: string
}

/**
 * The vocabulary, grouped by why an engine objects. Deliberately CONSERVATIVE:
 * a word only earns a place here if removing it can't gut the brief, which is
 * why plenty of adjacent words are missing on purpose —
 *   - 'sword', 'skull', 'dead'/'Day of the Dead', 'beer'/'wine'/'whiskey' and
 *     'battle' are all normal, sellable ITP design vocabulary that the engines
 *     draw without complaint, and
 *   - 'hip-hop' names a genre: softening it would delete the brief instead of
 *     the trigger (the hip-hop-monkey brief that surfaced this was refused for
 *     its gangster framing, not for the genre).
 * Adding to this list is a content call, not a code one — leave a note saying
 * which real refusal justified the entry.
 */
const SWAPS: Swap[] = [
  // Mascot/athletic aggression. The single best-documented false-positive
  // family in this codebase (worker-helpers.ts: "mascots, 'roaring', athletic
  // themes"), and the cheapest to reword without losing the design.
  { words: ['roaring', 'roars', 'roar'], to: 'proud', why: 'aggression cue — the most-flagged word on mascot briefs' },
  { words: ['snarling', 'snarl', 'growling', 'baring its teeth', 'baring their teeth', 'fanged', 'fangs'], to: 'confident', why: 'aggression cue' },
  { words: ['menacing', 'threatening', 'intimidating', 'ferocious', 'aggressive', 'furious', 'enraged', 'raging', 'vicious'], to: 'bold', why: 'aggression cue' },
  { words: ['attacking', 'charging at', 'lunging'], to: 'striding', why: 'reads as depicted violence' },

  // Violence. Dropped rather than reworded — there is no tamer synonym for a
  // weapon that still means the same thing.
  { words: ['gun', 'guns', 'handgun', 'pistol', 'rifle', 'shotgun', 'firearm', 'firearms', 'weapon', 'weapons'], to: '', why: 'weapon' },
  { words: ['knife', 'knives', 'dagger', 'machete'], to: '', why: 'weapon' },
  { words: ['blood', 'bloody', 'bleeding', 'gore', 'gory'], to: '', why: 'graphic violence' },
  { words: ['kill', 'killing', 'killer', 'murder', 'slaughter', 'massacre', 'decapitated'], to: '', why: 'graphic violence' },
  { words: ['shooting', 'gunshot', 'gunfire'], to: '', why: 'graphic violence' },
  { words: ['violent', 'violence', 'brutal', 'savage'], to: 'bold', why: 'violence wording' },

  // Crime/gang framing. Replaced with the aesthetic the brief was actually
  // after — this is the swap that unblocks the hip-hop-monkey class of brief.
  { words: ['gangster', 'gangsta', 'thug', 'mafia', 'cartel', 'pimp', 'drug dealer', 'trap house'], to: 'streetwear', why: 'crime framing — the style cue survives as "streetwear"' },

  // Substances. Only the ones with no legitimate ITP design use.
  { words: ['blunt', 'bong', 'weed', 'marijuana', 'cannabis', '420', 'drunk', 'booze'], to: '', why: 'drug reference' },

  // Sexualized wording. Dropped: every one of these is an adjective on a
  // subject the brief names anyway.
  { words: ['sexy', 'seductive', 'sensual', 'erotic', 'provocative', 'nude', 'naked', 'topless', 'shirtless', 'lingerie', 'busty', 'cleavage', 'thicc'], to: '', why: 'sexualized wording' },
]

/**
 * Does this job error mean the PROMPT was refused on content grounds, rather
 * than something technical (a timeout, a 500, no image in the output)?
 *
 * Matched against the whole error string on purpose: the design job aggregates
 * its roster's failures into one message ("All 1 models failed: GPT Image 2:
 * replicate …/flux-2-pro failed: E005 …" — see processImageJobInline in
 * backend/routes/admin/ai-products.ts), so the code arrives nested several
 * layers deep in the text.
 */
export function isSensitivityRefusal(error?: string | null): boolean {
  if (!error) return false
  return [
    /\bE005\b/i,
    /flagged as sensitive/i,
    /sensitive content/i,
    /\bNSFW\b/i,
    /content[-\s]?polic(?:y|ies)|content_policy/i,
    /safety (?:filter|system|checker)/i,
    /flagged by (?:the )?safety/i,
    /\bmoderation\b/i,
  ].some((re) => re.test(error))
}

/** What `softenPrompt` changed, so the panel can show its work. */
export interface PromptSwap {
  from: string
  to: string
  why: string
}

export interface SoftenedPrompt {
  prompt: string
  changes: PromptSwap[]
}

/** Tidy up after a dropped word: doubled spaces, orphaned punctuation, a
 *  trailing/leading separator. Keeps the suggestion readable enough to edit. */
function tidy(text: string): string {
  return text
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,;])\s*(?=[,;])/g, '')
    .replace(/\b(a|an|the|with|and|in|of|on)\s*,/gi, '$1')
    .replace(/^[\s,;.]+/, '')
    .replace(/[\s,;]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Rewrite the known trigger words out of a prompt, reporting every swap.
 *
 * Longest alternative first inside each group so 'baring its teeth' is matched
 * before 'teeth' would be by a future entry, and a dropped word takes an
 * immediately-following comma with it so "a sexy, bold cat" becomes "a bold
 * cat" rather than "a , bold cat".
 *
 * `changes` empty means nothing in the vocabulary matched — which is a real and
 * expected outcome. The caller must say so plainly and let the admin do the
 * rewording; inventing a change we can't justify would be worse than admitting
 * we have no suggestion.
 */
export function softenPrompt(prompt: string): SoftenedPrompt {
  let out = String(prompt ?? '')
  const changes: PromptSwap[] = []

  for (const swap of SWAPS) {
    const alternatives = [...swap.words].sort((a, b) => b.length - a.length)
    for (const word of alternatives) {
      // A dropped word eats one trailing comma; a replaced word keeps the
      // surrounding punctuation exactly as the admin wrote it.
      const re = swap.to
        ? new RegExp(`\\b${escape(word)}\\b`, 'gi')
        : new RegExp(`\\b${escape(word)}\\b,?\\s*`, 'gi')
      if (!re.test(out)) continue
      re.lastIndex = 0
      out = out.replace(re, swap.to ? swap.to : ' ')
      changes.push({ from: word, to: swap.to, why: swap.why })
    }
  }

  return { prompt: changes.length ? tidy(out) : out, changes }
}

/** Plain-English headline for the refusal card. */
export const SENSITIVITY_HEADLINE = 'The image engine refused this prompt'

/** The explanation under it. Says what happened and that it is often wrong —
 *  both are true, and an admin who thinks the design itself was rejected will
 *  throw away a sellable brief. */
export const SENSITIVITY_BODY =
  'It flagged the wording as sensitive rather than failing technically. That check ' +
  'fires on plenty of designs we sell — mascots, athletic themes and anything described as ' +
  'roaring or fierce trip it regularly. Reword the brief below and try again.'
