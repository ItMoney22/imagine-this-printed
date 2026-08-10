/**
 * Mockup QA — one vision pass that answers two DIFFERENT questions about a
 * generated product shot:
 *
 *   1. FIDELITY  — is this the same artwork? (re-drawn text, restyled art,
 *      wrong colors, invented elements, artwork hidden). Lifted from the Etsy
 *      shot pipeline, where it has been running since 2026-07-31.
 *   2. COVERAGE  — is it the right SIZE on the garment? (David 2026-08-09:
 *      "the mockup should not cover the entire shirt unless specified").
 *
 * These are genuinely independent: a print can be a pixel-perfect reproduction
 * and still be blown up shoulder-to-shoulder, which is the wrong product. So
 * coverage is judged against the placement the product was BUILT for, not
 * against a fixed idea of "normal" — a back-only design is supposed to be
 * large, a pocket print is supposed to be tiny, and failing either for being
 * what it was asked to be would be a false positive.
 *
 * Deliberately generous, for the same reason the Etsy checker is: it only fails
 * on things a buyer would call the wrong product. Fabric folds, lighting,
 * shadow, perspective, crop and the model are all fine. If the checker errors
 * or no key is configured the shot PASSES — a QA outage must never discard a
 * render that was already paid for.
 */

import OpenAI from 'openai'

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null
const OPENAI_VISION_MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-5.6-terra'
// gpt-5.x/o-series reject a non-default temperature and want max_completion_tokens.
const isReasoningModel = (m: string) => /^(o[1-9]|gpt-5)/.test(m)

export type PrintPlacement = 'front-center' | 'left-pocket' | 'back-only' | 'front-back' | 'pocket-front-back-full'

export interface MockupCheck {
  ok: boolean
  /** Which gate failed — lets callers report "too big" separately from "wrong art". */
  failed?: 'fidelity' | 'coverage'
  reason?: string
  /** True when the shot needed a second render to pass. */
  retried?: boolean
}

/**
 * How much of the garment the print is ALLOWED to occupy, per placement.
 * Phrased as instructions to a vision model rather than numbers, because a
 * model judges "spans the whole shirt" far more reliably than it estimates a
 * percentage.
 */
const COVERAGE_RULE: Record<string, string> = {
  'front-center':
    'The print belongs on the CHEST as a centered graphic. It should leave clear blank fabric ' +
    'visible around it — above it near the collar, below it toward the hem, and on both sides ' +
    'toward the sleeves. FAIL it only if the artwork is blown up so large it spans essentially ' +
    'the entire front of the garment (edge to edge, or collar to hem) like an all-over print.',
  'left-pocket':
    'The print belongs on the LEFT CHEST at pocket size — small, roughly the size of a pocket, ' +
    'high on one side of the chest. FAIL it if the artwork is rendered large across the chest ' +
    'instead of as a small pocket-sized print.',
  'back-only':
    'The print belongs LARGE on the BACK of the garment. A big back print is CORRECT here — do ' +
    'not fail it for being large. FAIL it only if the print appears on the front instead.',
  // Two-sided product. Per-side mockup jobs override their placement to
  // 'front-center' / 'back-only' at fan-out, so this rule only fires when a
  // front-back render arrives without the per-side override — judge it like a
  // front print, since the single visible side in that case is the front.
  'front-back':
    'This product is printed on BOTH sides; this photo shows one side. A centered chest print ' +
    'OR a large back print are both CORRECT. FAIL it only if the artwork is blown up so large ' +
    'it spans essentially the entire garment edge to edge like an all-over print.',
  'pocket-front-back-full':
    'This design is specified as a small front-left pocket print AND a large back print, so ' +
    'both a small front print and a large back print are CORRECT. Do not fail it for either.',
}

/** An all-over print was explicitly asked for — coverage must not be judged. */
export function coverageIsExempt(placement?: string | null): boolean {
  const p = String(placement ?? '').toLowerCase()
  return p.includes('all-over') || p.includes('all_over') || p.includes('full-print') || p.includes('fullprint')
}

function coverageRuleFor(placement?: string | null, sizeInches?: number | null): string {
  const p = String(placement ?? 'front-center')
  const base = COVERAGE_RULE[p] ?? COVERAGE_RULE['front-center']
  // A concrete size sharpens the judgement for chest/back prints. Pocket and
  // pocket+back carry their own scale in the base rule already.
  if (!sizeInches || p === 'left-pocket' || p === 'pocket-front-back-full') return base
  const inches = Math.round(sizeInches)
  const ratio = inches / 21
  const fraction = ratio <= 0.28 ? 'about a quarter' : ratio <= 0.45 ? 'about a third' : ratio <= 0.58 ? 'about half' : 'about two-thirds'
  return (
    base +
    ` The design was specified as a ${inches}-inch-wide print — on an adult garment that is ` +
    `${fraction} of the garment's width. FAIL it if the print is rendered dramatically larger than that.`
  )
}

/**
 * Compare source artwork against a rendered mockup. Returns null when QA could
 * not run at all (no key, model error) — callers MUST treat null as a pass.
 */
export async function checkMockup(
  designUrl: string,
  mockupUrl: string,
  placement?: string | null,
  sizeInches?: number | null
): Promise<MockupCheck | null> {
  if (!openai) return null

  const judgeCoverage = !coverageIsExempt(placement)
  const coverageBlock = judgeCoverage
    ? `\nSIZE / PLACEMENT — judge this SEPARATELY from whether the artwork matches:\n${coverageRuleFor(placement, sizeInches)}\n`
    : '\nSIZE / PLACEMENT: this product is an intentional all-over print. Do NOT judge the print size at all.\n'

  try {
    const response = await openai.chat.completions.create({
      model: OPENAI_VISION_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'You are a print-shop QA inspector. You compare a source artwork against a photo of that artwork ' +
            'printed on a product, and you report only defects a customer would consider the WRONG product.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                'IMAGE 1 is the source artwork. IMAGE 2 is a generated product photo that is supposed to show ' +
                'IMAGE 1 printed on the item.\n\n' +
                'ARTWORK FIDELITY — fail if any of these are true:\n' +
                '- Any text differs: misspelled, different wording, re-drawn in a different typeface, different ' +
                'line breaks, or letters that are garbled/illegible.\n' +
                '- The artwork was restyled, redrawn, or re-illustrated rather than reproduced.\n' +
                '- Colors are clearly different from the source.\n' +
                '- Elements were added that are not in the source (extra text, logos, watermarks, icons).\n' +
                '- Part of the artwork is missing, cropped off, or hidden behind an arm, hair or object.\n' +
                coverageBlock +
                '\nDo NOT fail for fabric folds distorting the print, lighting, shadow across the print, ' +
                'perspective, the model, or the background.\n\n' +
                'Respond in JSON: {"matches": true|false, "sizeOk": true|false, "issue": "one short sentence ' +
                'naming the single worst defect, or empty string when it passes"}. ' +
                (judgeCoverage ? 'Set sizeOk to false ONLY for the size/placement problem described above.' : 'Always set sizeOk to true.'),
            },
            { type: 'image_url', image_url: { url: designUrl, detail: 'high' } },
            { type: 'image_url', image_url: { url: mockupUrl, detail: 'high' } },
          ],
        },
      ],
      ...(isReasoningModel(OPENAI_VISION_MODEL)
        ? { max_completion_tokens: 900 }
        : { max_tokens: 250, temperature: 0 }),
      response_format: { type: 'json_object' },
    })

    const content = response.choices[0]?.message?.content
    if (!content) return null
    const parsed = JSON.parse(content)

    // Absent field = pass, so a model that omits a key never fails a good shot.
    const fidelityOk = parsed?.matches !== false
    const sizeOk = !judgeCoverage || parsed?.sizeOk !== false
    if (fidelityOk && sizeOk) return { ok: true }

    // Fidelity outranks coverage: "we printed the wrong art" is a more
    // actionable message than "it's too big" when both are wrong.
    return {
      ok: false,
      failed: fidelityOk ? 'coverage' : 'fidelity',
      reason: String(
        parsed?.issue || (fidelityOk ? 'print is too large for its placement' : 'design did not match the source art')
      ).slice(0, 200),
    }
  } catch (err: any) {
    // Our QA problem, not the shot's — never burn a retry on it.
    console.warn(`[mockup-qa] check unavailable (${err?.message || err}) — accepting the shot`)
    return null
  }
}

/**
 * Run QA over a freshly rendered mockup and buy at most ONE corrective retry,
 * matching the Etsy shot pipeline's contract. `rerender` is given the reason so
 * the caller can feed it back into the prompt.
 *
 * Returns the render being kept plus its verdict. A verdict with ok:false means
 * it failed twice and should land FLAGGED, not discarded — a flagged mockup an
 * admin can see beats no mockup at all.
 */
export async function verifyWithOneRetry(
  designUrl: string,
  firstUrl: string,
  placement: string | null | undefined,
  rerender: (reason: string) => Promise<string | null>,
  label = 'mockup',
  sizeInches?: number | null
): Promise<{ url: string; check: MockupCheck }> {
  const verdict = await checkMockup(designUrl, firstUrl, placement, sizeInches)
  if (!verdict || verdict.ok) return { url: firstUrl, check: { ok: true } }

  console.warn(`[mockup-qa] ${label} failed ${verdict.failed} QA: ${verdict.reason} — one retry`)

  const retryUrl = await rerender(verdict.reason || 'the print did not match the source artwork')
  // Re-render refused or failed: keep the original, flagged with why.
  if (!retryUrl) return { url: firstUrl, check: { ...verdict, retried: true } }

  const retryVerdict = await checkMockup(designUrl, retryUrl, placement, sizeInches)
  if (!retryVerdict || retryVerdict.ok) return { url: retryUrl, check: { ok: true, retried: true } }

  console.warn(`[mockup-qa] ${label} still failing after retry: ${retryVerdict.reason}`)
  return { url: retryUrl, check: { ...retryVerdict, retried: true } }
}
