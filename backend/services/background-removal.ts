// One background-removal decision for the whole site.
//
// There are two very different tools here and they are NOT interchangeable:
//
//   COLOUR KEY (bg-key.ts)  judges every pixel on its own, so it keeps ALL the
//                           artwork - including pieces that float free of the
//                           main subject.
//   AI SEGMENTATION         (Replicate 851-labs/background-remover) finds THE
//                           single most salient subject and discards the rest.
//
// Reaching for the second one by default is what deleted the cherry-blossom
// branch from David's Stoic Samurai design: the branch never touches the
// samurai, so the model read it as background (7.4% of the blossom quadrant
// survived, vs 37.6% through the key). No input on that model changes this -
// its only knob is `threshold`, which controls mask hardness.
//
// Our designs are generated on a SOLID shirt-colour field, so the key is almost
// always the right tool. AI segmentation stays as the fallback for the
// complex/photographic sources it is genuinely good at - a user-uploaded photo
// has no flat field to key.
//
// The two are not purely alternatives, though. A key cannot keep line work drawn
// in the FIELD'S OWN COLOUR - black outlines on a black field are the same
// pixels as the background and drain out with it - and that is precisely what
// segmentation, which reasons about the subject's shape, gets right. So on a
// solid field the key does the cut and the mask is then allowed to fill ink back
// in strictly INSIDE it (see restoreEnclosedInk). Each tool contributes only
// what it is good at; neither can undo the other.
//
// Every caller goes through here so the behaviour cannot drift apart again.

import { detectSolidBg, keyOutConnectedBackground, restoreEnclosedInk, type SolidBg } from './bg-key.js'
import { removeBackgroundSync } from './replicate.js'

export type BgRemovalMethod = 'color-key' | 'color-key+ai-ink' | 'ai-segmentation'

export interface BgRemovalResult {
  /** The transparent PNG. Callers upload this wherever it belongs. */
  buffer: Buffer
  method: BgRemovalMethod
  /** Which solid field was keyed out, or null when AI segmentation ran. */
  background: SolidBg | null
}

/**
 * Strip the background from `imageUrl`, choosing the right tool for the source.
 *
 * Always resolves to a PNG buffer so callers upload one way regardless of which
 * path ran. Falls back to AI segmentation if the source can't be fetched for
 * inspection, since that path takes the URL directly.
 */
export async function removeBackgroundToBuffer(imageUrl: string, label = 'bg'): Promise<BgRemovalResult> {
  // A failed fetch here is NOT harmless: it silently downgrades the design to
  // AI segmentation, which is the exact behaviour this module exists to avoid.
  // Retry once before giving up, and shout about it either way so a bad cut is
  // traceable to its cause rather than looking like the keyer got it wrong.
  let source: Buffer | null = null
  for (let attempt = 1; attempt <= 2 && !source; attempt++) {
    try {
      const res = await fetch(imageUrl)
      if (res.ok) { source = Buffer.from(await res.arrayBuffer()); break }
      console.error(`[${label}] source fetch returned ${res.status} (attempt ${attempt}/2)`)
    } catch (e: any) {
      console.error(`[${label}] source fetch failed: ${e?.message} (attempt ${attempt}/2)`)
    }
    if (!source && attempt === 1) await new Promise((r) => setTimeout(r, 750))
  }
  if (!source) {
    console.error(`[${label}] COULD NOT READ THE SOURCE - falling back to AI segmentation, ` +
      `which drops artwork detached from the main subject. This cut should be redone.`)
  }

  const background = source ? await detectSolidBg(source) : null
  if (source && background) {
    console.log(`[${label}] solid ${background} background -> colour key (keeps disconnected art)`)
    const keyed = await keyOutConnectedBackground(source, background)

    // Second opinion, for the ink the key is blind to by construction. Failing
    // here is not fatal - the keyed cut is already a correct cut, just a thinner
    // one on line art - so log and ship it rather than losing the whole job.
    try {
      const maskUrl = await removeBackgroundSync(imageUrl)
      const res = await fetch(maskUrl)
      if (!res.ok) throw new Error(`mask fetch failed (${res.status})`)
      const merged = await restoreEnclosedInk(keyed, Buffer.from(await res.arrayBuffer()))
      if (merged.restored > 0) {
        console.log(`[${label}] segmentation restored ${(merged.restored * 100).toFixed(2)}% ` +
          `of the image as field-coloured ink inside the artwork`)
        return { buffer: merged.buffer, method: 'color-key+ai-ink', background }
      }
    } catch (e: any) {
      console.error(`[${label}] ink pass skipped: ${e?.message} - shipping the colour key alone, ` +
        `which can look thin wherever the art is drawn in the field's own colour`)
    }

    return { buffer: keyed, method: 'color-key', background }
  }

  console.log(`[${label}] no solid background -> AI subject segmentation`)
  const url = await removeBackgroundSync(imageUrl)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Background remover output fetch failed (${res.status})`)
  return { buffer: Buffer.from(await res.arrayBuffer()), method: 'ai-segmentation', background: null }
}
