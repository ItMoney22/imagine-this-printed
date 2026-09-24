// Team plate — one-click setup: read the sample lettering off the art.
//
// David 2026-09-24: "I was lost trying to figure out how to put a name on the
// shirt." The old setup made a person drag a box over the name, drag a box over
// the number and type what each one read. A vision model can do all three: it
// sees "BEAR" and "9", and roughly where they sit. The boxes were only ever
// placement HINTS for the lettering prompt (lettering-prompt.ts), and the sample
// text is what tells the edit which words to replace — so a close guess is
// enough, and the person's only job is to look at a preview of their own name.
//
// Pure parts (normalizeDetection, buildAutoTemplate) are pinned by tests;
// detectSampleLettering is the one network call.
import OpenAI from 'openai'
import type { Stroke, TeamField, TeamTemplate } from '../../shared/team-template.js'
import { TEAM_TEMPLATE_VERSION } from '../../shared/team-template.js'

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null

// Same model as the lettering proofreader, for the same reason: it reports the
// glyphs it sees instead of the word it expects (lettering-check.ts).
const DETECT_MODEL = process.env.OPENAI_LETTERING_MODEL || 'gpt-4.1'

export interface FracBox {
  x: number
  y: number
  w: number
  h: number
}

export interface SampleDetection {
  name: { text: string; box: FracBox; arched: boolean } | null
  number: { text: string; box: FracBox } | null
}

/** Where a name and number usually sit on a team back print, as fractions of the art. */
export const DEFAULT_NAME_BOX: FracBox = { x: 0.1, y: 0.04, w: 0.8, h: 0.2 }
export const DEFAULT_NUMBER_BOX: FracBox = { x: 0.2, y: 0.26, w: 0.6, h: 0.5 }

const DETECT_PROMPT =
  'This is the back print of a team sports shirt. Find the PLAYER NAME (a surname-style word, often arched) and the ' +
  'PLAYER NUMBER (one or two digits, usually the biggest element). Ignore team names, slogans, years and small text. ' +
  'Transcribe each exactly as drawn, glyph by glyph, and give its bounding box as fractions of the image ' +
  '(x and y = top-left corner, w and h = size, all between 0 and 1). Say whether the name is arched. ' +
  'Reply as JSON: {"name":{"text":"...","box":{"x":0,"y":0,"w":0,"h":0},"arched":true}|null,' +
  '"number":{"text":"...","box":{"x":0,"y":0,"w":0,"h":0}}|null}'

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

function toBox(raw: unknown, fallback: FracBox): FracBox {
  const b = (raw ?? {}) as Record<string, unknown>
  const nums = [b.x, b.y, b.w, b.h].map(Number)
  if (!nums.every(Number.isFinite)) return fallback
  let [x, y, w, h] = nums
  // Some answers come back in percent. Anything over 1 is read that way.
  if ([x, y, w, h].some((n) => n > 1.5)) [x, y, w, h] = [x, y, w, h].map((n) => n / 100)
  x = clamp01(x)
  y = clamp01(y)
  w = Math.min(1 - x, Math.max(0, w))
  h = Math.min(1 - y, Math.max(0, h))
  // A sliver is a misread, not a zone.
  if (w < 0.03 || h < 0.02) return fallback
  // Pad a little: the box is a placement hint and a longer name needs room.
  const padX = w * 0.06
  const padY = h * 0.08
  const px = clamp01(x - padX)
  const py = clamp01(y - padY)
  return { x: px, y: py, w: Math.min(1 - px, w + 2 * padX), h: Math.min(1 - py, h + 2 * padY) }
}

/** Coerce a vision answer into a detection; anything unusable falls back to the usual spots. */
export function normalizeDetection(raw: unknown): SampleDetection {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
  const nameText = typeof r.name?.text === 'string' ? r.name.text.replace(/[^A-Za-z '-]/g, '').trim().toUpperCase() : ''
  const numberText = typeof r.number?.text === 'string' ? r.number.text.replace(/[^0-9]/g, '').slice(0, 3) : ''
  return {
    name: nameText ? { text: nameText.slice(0, 24), box: toBox(r.name.box, DEFAULT_NAME_BOX), arched: r.name.arched !== false } : null,
    number: numberText ? { text: numberText, box: toBox(r.number.box, DEFAULT_NUMBER_BOX) } : null,
  }
}

/** Ask the vision model where the sample name and number are. Null when it cannot run. */
export async function detectSampleLettering(imageUrl: string): Promise<SampleDetection | null> {
  if (!openai) return null
  try {
    const response = await openai.chat.completions.create({
      model: DETECT_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: DETECT_PROMPT },
            { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
          ],
        },
      ],
      max_tokens: 300,
      temperature: 0,
      response_format: { type: 'json_object' },
    })
    const content = response.choices[0]?.message?.content
    return content ? normalizeDetection(JSON.parse(content)) : null
  } catch (err: any) {
    console.warn('[team-plate auto-setup] could not read the sample lettering:', err?.message)
    return null
  }
}

function zoneOf(box: FracBox, canvas: { w: number; h: number }) {
  const x = Math.round(clamp01(box.x) * canvas.w)
  const y = Math.round(clamp01(box.y) * canvas.h)
  return {
    x,
    y,
    w: Math.max(1, Math.min(canvas.w - x, Math.round(box.w * canvas.w))),
    h: Math.max(1, Math.min(canvas.h - y, Math.round(box.h * canvas.h))),
  }
}

export interface AutoTemplateInput {
  sourceAssetId: string
  canvas: { w: number; h: number; dpi: number }
  detection: SampleDetection | null
  /** Colours sampled inside each zone (eyedropColours), keyed 'name' / 'number'. */
  colours: Partial<Record<'name' | 'number', { fill: string; strokes: Stroke[] }>>
  /** Kept from an existing template, so re-running setup never resets a price. */
  upcharge?: number
  styleNotes?: string
}

/**
 * The template a customer page needs: a Name field and a Number field, placed
 * where the art already has them. Both fields exist even when the art only
 * shows one, because the customer picks the placement (name + number, number
 * only, name only) and an empty value is removed cleanly by the prompt.
 */
export function buildAutoTemplate(input: AutoTemplateInput): TeamTemplate {
  const { canvas, detection } = input
  const nameBox = detection?.name?.box ?? DEFAULT_NAME_BOX
  const numberBox = detection?.number?.box ?? DEFAULT_NUMBER_BOX
  const font = { family: 'flare-matched', src: 'house' }

  const field = (
    key: 'name' | 'number',
    box: FracBox,
    extra: Pick<TeamField, 'label' | 'type' | 'max' | 'uppercase' | 'arch' | 'sample'>
  ): TeamField => ({
    key,
    ...extra,
    zone: zoneOf(box, canvas),
    font,
    fill: input.colours[key]?.fill ?? '#FFFFFF',
    strokes: input.colours[key]?.strokes ?? [],
    offset: null,
  })

  return {
    version: TEAM_TEMPLATE_VERSION,
    side: 'back_image',
    plateAssetId: input.sourceAssetId,
    sourceAssetId: input.sourceAssetId,
    distressAssetId: null,
    canvas,
    halftone: false,
    upcharge: input.upcharge && input.upcharge > 0 ? input.upcharge : 0,
    styleNotes: input.styleNotes ?? '',
    fields: [
      field('name', nameBox, {
        label: 'Name',
        type: 'text',
        max: 12,
        uppercase: true,
        arch: detection?.name?.arched === false ? 0 : 16,
        sample: detection?.name?.text ?? '',
      }),
      field('number', numberBox, {
        label: 'Number',
        type: 'number',
        max: 2,
        uppercase: false,
        arch: 0,
        sample: detection?.number?.text ?? '',
      }),
    ],
  }
}
