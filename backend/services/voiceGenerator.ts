// Mr. and Mrs. Imagine speak with Gemini 3.8 Flash TTS (David 2026-10-07: "since we're doing everything Gemini 3.8
// TTS ... pick a male character and make it high pitch, sound like a fluffy character, Barney type ... and then do
// Mrs. Imagine too"). This replaced the MiniMax Speech-02-Turbo clone on Replicate.
//
// Voices picked on 23 ear-checked takes (Amelia Chan, 2026-10-07). Both are STOCK Gemini voices: designed voices
// drifted female once pitched up, expire after a year, and only play on the key that made them.
//   Mr. Imagine:  Puck, 6/6 takes heard as "an adult male doing a high-pitched, cuddly kids-show mascot voice"
//   Mrs. Imagine: Laomedeia, 2/2 heard as "bright, warm, smiling, motherly kids-show host"
//
// API: POST v1beta/interactions on GOOGLE_API_KEY (ITP's own Gemini key). MP3 comes back as base64 and is returned as
// a data: URL, so every caller keeps playing `audioUrl` the way it did. About 1.35 cents a minute of speech through
// 2026-12-31 (it doubles on 2027-01-01).

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions'

/** Main model first; the Flash-Lite TTS model reads the line when the main one is at its daily cap or down. */
export const TTS_MODELS = ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts']

/** Who is speaking. The style is one short line (Google: long direction makes the voice drift). */
export const PERSONAS = {
  'mr-imagine': { voice: 'Puck', style: 'high-pitched, goofy cartoon mascot voice, warm and gentle, smiling' },
  'mrs-imagine': { voice: 'Laomedeia', style: 'bright, sweet, warm and motherly cartoon mascot voice, playful and encouraging, smiling' },
} as const

export type Persona = keyof typeof PERSONAS

export function isPersona(v: unknown): v is Persona {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(PERSONAS, v)
}

/** Inline sounds Gemini performs (<laugh>, <short pause> ...). Any other <tag> would be read out, so it is dropped. */
const GEMINI_TAGS = new Set([
  'breath', 'chuckle', 'gasp', 'giggle', 'laugh', 'sigh', 'whispers', 'cheer', 'phew', 'short pause', 'long pause',
])

/**
 * Text ready for Gemini: old MiniMax pause markers (<#0.3#>) become <short pause> (a second or more: <long pause>),
 * tags Gemini doesn't perform are dropped, whitespace is tidied. The words themselves are never changed.
 */
export function ttsText(text: string): string {
  return String(text ?? '')
    .replace(/<#\s*([\d.]+)\s*#>/g, (_, s: string) => (Number(s) >= 1 ? ' <long pause> ' : ' <short pause> '))
    .replace(/<\s*(\/?)\s*([a-z][a-z ]*?)\s*>/gi, (_, close: string, tag: string) =>
      !close && GEMINI_TAGS.has(tag.toLowerCase()) ? ` <${tag.toLowerCase()}> ` : ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .trim()
}

/** The request body for one persona reading one line on one model. */
export function speechBody(text: string, persona: Persona, model = TTS_MODELS[0]) {
  const { voice, style } = PERSONAS[persona]
  return {
    model,
    input: [{ type: 'user_input', content: [{ type: 'text', text: ttsText(text), annotations: [{ type: 'speech_metadata', style }] }] }],
    response_format: { type: 'audio', mime_type: 'audio/mp3' },
    generation_config: { speech_config: [{ voice }] },
  }
}

/** MP3 bytes of `persona` reading `text`. A limit or outage on the main model moves the same line to the next one. */
export async function synthesizeSpeech(text: string, persona: Persona = 'mr-imagine'): Promise<Buffer> {
  const key = process.env.GOOGLE_API_KEY
  if (!key) throw new Error('GOOGLE_API_KEY is not configured')
  if (!ttsText(text)) throw new Error('Nothing to say')
  let last = ''
  for (const model of TTS_MODELS) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify(speechBody(text, persona, model)),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) {
      last = `Gemini TTS ${res.status} on ${model}: ${(await res.text()).slice(0, 200)}`
      if (res.status === 429 || res.status >= 500) continue
      throw new Error(last)
    }
    const j = (await res.json()) as { steps?: { type?: string; content?: { type?: string; data?: string }[] }[] }
    const clip = (j.steps ?? []).filter((s) => s.type === 'model_output').flatMap((s) => s.content ?? []).filter((c) => c.type === 'audio').pop()
    if (clip?.data) return Buffer.from(clip.data, 'base64')
    last = `Gemini TTS answered with no audio on ${model}`
  }
  throw new Error(last)
}

/**
 * Speak `text` as Mr. Imagine (default) or Mrs. Imagine. Returns a playable data: URL (audio/mpeg), so pages set it
 * straight on an <audio> element.
 */
export async function generateVoiceResponse(text: string, options: { persona?: Persona } = {}): Promise<string> {
  if (text.length > 10000) throw new Error('Text exceeds maximum length of 10,000 characters')
  try {
    const mp3 = await synthesizeSpeech(text, options.persona ?? 'mr-imagine')
    return `data:audio/mpeg;base64,${mp3.toString('base64')}`
  } catch (error: any) {
    console.error('[voice] Speech generation failed:', error?.message)
    throw new Error(`Voice generation failed: ${error?.message}`)
  }
}
