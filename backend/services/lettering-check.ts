// Lettering check — read the words back off a rendered image.
//
// GPT Image 2.5 Flare spells well, not perfectly. Live 2026-09-24 a Flare Lab
// text swap asked for "SMITH" (spelled S-M-I-T-H in the prompt) and drew
// "SMTH". On a team shirt that is a misprinted name on a paid order, so every
// lettering render is read back by a vision model and compared to what was
// asked for (task 630bae57).
//
// The comparison is pure (compareLettering) and pinned by tests; readLettering
// is the one network call. A checker that cannot run returns null, and callers
// treat null as "unverified" — never as a pass shown to the operator as one.
import OpenAI from 'openai'

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null

// NOT the house vision model. Measured live 2026-09-24 on the real "SMTH"
// render: gpt-5.6-terra (OPENAI_VISION_MODEL) read it as "SMITH" under every
// prompt tried — it autocorrects, which is the one thing a proofreader must
// not do. gpt-4.1 with the glyph-by-glyph prompt below read "SMTH" 5/5 and
// the correct "SMITH 22" proof 5/5; gpt-4o matched it.
const LETTERING_MODEL = process.env.OPENAI_LETTERING_MODEL || 'gpt-4.1'
const isReasoningModel = (m: string) => /^(o[1-9]|gpt-5)/.test(m)

const GLYPH_PROMPT =
  'This is print artwork. For EACH separate word or number in it, count the individual letter shapes you can ' +
  'actually see and transcribe them one glyph at a time, left to right. Do NOT read it as a word first - a word ' +
  'may be MISSPELLED or have a letter missing, and you must report exactly the glyphs present, not the word it ' +
  'resembles. Thin letters like I and 1 count. Reply as JSON: {"items":[{"glyphs":["S","M","..."],"count":N}]}'

export interface LetteringVerdict {
  ok: boolean
  /** Every piece of text the checker saw, verbatim. */
  read: string[]
  /** Expected values that were not found, with the closest thing that was. */
  mismatches: Array<{ expected: string; closest: string | null }>
}

/** Upper-case, letters/digits only — the checker's quotes and spacing are not the point. */
export function normalizeLettering(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return dp[a.length][b.length]
}

/**
 * Is every expected value present, exactly, in what was read?
 *
 * A value may appear inside a longer read line ("SMITH 22" read as one line),
 * so presence is checked against each line AND the lines joined. The closest
 * miss is reported so the operator sees "SMTH", not just "failed".
 */
export function compareLettering(expected: string[], read: string[]): LetteringVerdict {
  const wanted = expected.map((e) => e.trim()).filter(Boolean)
  const lines = read.map(normalizeLettering).filter(Boolean)
  const joined = lines.join('')
  const words = read.flatMap((r) => r.split(/\s+/)).map(normalizeLettering).filter(Boolean)
  const mismatches: LetteringVerdict['mismatches'] = []
  for (const value of wanted) {
    const v = normalizeLettering(value)
    if (!v) continue
    const found = lines.includes(v) || words.includes(v) || (v.length >= 3 && joined.includes(v))
    if (found) continue
    const pool = [...new Set([...lines, ...words])]
    const closest = pool.length ? pool.reduce((best, w) => (editDistance(w, v) < editDistance(best, v) ? w : best)) : null
    mismatches.push({ expected: value, closest })
  }
  return { ok: mismatches.length === 0, read, mismatches }
}

/** Ask a vision model for every piece of text in the image; null when it cannot run. */
export async function readLettering(imageUrl: string, expected: string[]): Promise<LetteringVerdict | null> {
  if (!openai || expected.filter((e) => e.trim()).length === 0) return null
  try {
    const response = await openai.chat.completions.create({
      model: LETTERING_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: GLYPH_PROMPT },
            { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
          ],
        },
      ],
      ...(isReasoningModel(LETTERING_MODEL) ? { max_completion_tokens: 2000 } : { max_tokens: 400, temperature: 0 }),
      response_format: { type: 'json_object' },
    })
    const content = response.choices[0]?.message?.content
    if (!content) return null
    const parsed = JSON.parse(content)
    const items: unknown[] = Array.isArray(parsed?.items) ? parsed.items : []
    const texts = items
      .map((i: any) => (Array.isArray(i?.glyphs) ? i.glyphs.filter((g: unknown) => typeof g === 'string').join('') : ''))
      .filter(Boolean)
    return compareLettering(expected, texts)
  } catch (err: any) {
    console.warn('[lettering-check] could not read the image:', err?.message)
    return null
  }
}
