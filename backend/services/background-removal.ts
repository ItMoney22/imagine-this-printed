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
// Every caller goes through here so the behaviour cannot drift apart again.

import { detectSolidBg, keyOutConnectedBackground, type SolidBg } from './bg-key.js'
import { removeBackgroundSync } from './replicate.js'

export type BgRemovalMethod = 'color-key' | 'ai-segmentation'

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
  let source: Buffer | null = null
  try {
    const res = await fetch(imageUrl)
    if (res.ok) source = Buffer.from(await res.arrayBuffer())
    else console.warn(`[${label}] source fetch returned ${res.status}; using AI segmentation`)
  } catch (e: any) {
    console.warn(`[${label}] source fetch failed (${e?.message}); using AI segmentation`)
  }

  const background = source ? await detectSolidBg(source) : null
  if (source && background) {
    console.log(`[${label}] solid ${background} background -> colour key (keeps disconnected art)`)
    return { buffer: await keyOutConnectedBackground(source, background), method: 'color-key', background }
  }

  console.log(`[${label}] no solid background -> AI subject segmentation`)
  const url = await removeBackgroundSync(imageUrl)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Background remover output fetch failed (${res.status})`)
  return { buffer: Buffer.from(await res.arrayBuffer()), method: 'ai-segmentation', background: null }
}
