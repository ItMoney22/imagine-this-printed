// =============================================================================
// Mr. Imagine on the phone through Gemini 3.8 Live (task 20d54c05). Same shape as
// Darrell V2 src/lib/phone-gemini.ts, the shared voice bridge's reference.
//
// The shared Fly bridge picks Gemini when POST /api/phone/agent/session answers
// with voiceProvider "gemini", and connects with whatever credentials that answer
// carries. So the key never leaves this API: we mint a ONE-USE ephemeral token per
// call, and the bridge opens the constrained Live endpoint with it.
//
//   PHONE_GEMINI_API_KEY  the phone's own key, in a Google project with no other
//                         Live traffic (fleet lesson ff4e3e8f: a client's key
//                         shares nobody's quota). No key, no token, no Mr. Imagine.
//   PHONE_GEMINI_VOICE    optional override; Puck (upbeat) by default.
//
// There is no Grok fallback. A token that will not mint makes the session route
// refuse, the bridge hangs up its socket, and the call falls through to the
// <Dial> after the <Connect> in /api/phone/twilio/incoming: it rings the shop.
// =============================================================================

export const PHONE_GEMINI_LIVE_MODEL = 'models/gemini-3.8-live'

export const GEMINI_LIVE_CONSTRAINED_WS =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained'

/** The bridge hangs up at 20 minutes; the token outlives that with room to spare. */
const TOKEN_LIFETIME_MS = 25 * 60_000
/** The bridge opens its socket within seconds of fetching the session. */
const TOKEN_OPEN_WINDOW_MS = 2 * 60_000

export function phoneGeminiVoice(): string {
  return process.env.PHONE_GEMINI_VOICE?.trim() || 'Puck'
}

export function phoneUsesGemini(): boolean {
  return !!process.env.PHONE_GEMINI_API_KEY
}

type FetchLike = typeof fetch

/** A one-use Live token for one call, or null when Google will not mint one. */
export async function mintPhoneLiveToken(now = Date.now(), fetchImpl: FetchLike = fetch): Promise<string | null> {
  const key = process.env.PHONE_GEMINI_API_KEY
  if (!key) return null
  try {
    const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/auth_tokens?key=${key}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        uses: 1,
        expireTime: new Date(now + TOKEN_LIFETIME_MS).toISOString(),
        newSessionExpireTime: new Date(now + TOKEN_OPEN_WINDOW_MS).toISOString(),
      }),
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) {
      console.warn(`[phone] gemini live token refused (${res.status}); this call rings the shop`)
      return null
    }
    const name = ((await res.json()) as { name?: unknown }).name
    return typeof name === 'string' && name ? name : null
  } catch (err) {
    console.warn(`[phone] gemini live token failed; this call rings the shop: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}
