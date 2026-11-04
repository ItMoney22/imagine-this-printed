// =============================================================================
// Twilio, by hand, for ITP's phone line (task 20d54c05). The backend has no
// `twilio` package, and the line needs only three things from it: check a
// webhook's signature, write a little TwiML, and redirect a live call. All
// three are small and pure enough to test without the network.
//
// Env (Render API + the Fly api app):
//   TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN   the MetaSphere Marketing account
//   TWILIO_PHONE_NUMBER                      +14702278666
//   PHONE_FORWARD_TO                         who a person-call rings (David's mobile)
//   PHONE_PUBLIC_URL                         https://api.imaginethisprinted.com, the
//                                            origin Twilio and the bridge call back
//   VOICE_BRIDGE_URL / VOICE_BRIDGE_TOKEN    the shared bridge; unset URL = forward only
//   PHONE_AI_ENABLED=false                   kill switch: calls forward, no Mr. Imagine
// =============================================================================
import { createHmac, timingSafeEqual } from 'crypto'

export interface PhoneConfig {
  accountSid: string
  authToken: string
  phoneNumber: string
  forwardTo: string
  /** Enough to answer a call and ring the shop. */
  ready: boolean
}

export function phoneConfig(): PhoneConfig {
  const accountSid = process.env.TWILIO_ACCOUNT_SID || ''
  const authToken = process.env.TWILIO_AUTH_TOKEN || ''
  const phoneNumber = process.env.TWILIO_PHONE_NUMBER || ''
  const forwardTo = process.env.PHONE_FORWARD_TO || ''
  return { accountSid, authToken, phoneNumber, forwardTo, ready: Boolean(accountSid && authToken && forwardTo) }
}

/** The public origin Twilio and the bridge use to reach this API. */
export function phonePublicBase(fallbackOrigin?: string): string {
  return (process.env.PHONE_PUBLIC_URL || process.env.API_ORIGIN || fallbackOrigin || 'http://localhost:4000').replace(/\/+$/, '')
}

// ── signatures ──────────────────────────────────────────────────────────────

/**
 * Twilio's X-Twilio-Signature: base64(HMAC-SHA1(authToken, url + each POST param
 * name and value, names sorted)). `url` is the exact URL Twilio requested, query
 * string included.
 */
export function twilioSignature(authToken: string, url: string, params: Record<string, unknown>): string {
  let base = url
  for (const key of Object.keys(params).sort()) {
    const value = params[key]
    const values = Array.isArray(value) ? value.map(String).sort() : [value == null ? '' : String(value)]
    for (const v of values) base += key + v
  }
  return createHmac('sha1', authToken).update(Buffer.from(base, 'utf-8')).digest('base64')
}

export function validTwilioSignature(
  authToken: string,
  signature: string | null | undefined,
  url: string,
  params: Record<string, unknown>,
): boolean {
  if (!authToken || !signature) return false
  const expected = Buffer.from(twilioSignature(authToken, url, params))
  const given = Buffer.from(signature)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

// ── TwiML ───────────────────────────────────────────────────────────────────

export function xmlEscape(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

const attrs = (a: Record<string, string | number | undefined>) =>
  Object.entries(a)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => ` ${k}="${xmlEscape(String(v))}"`)
    .join('')

export const twiml = (inner: string) => `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`

export function say(text: string): string {
  return `<Say voice="Polly.Joanna">${xmlEscape(text)}</Say>`
}

/**
 * Ring a number. `action` is where Twilio posts the Dial's result (DialCallStatus) when it ends, and the call
 * continues with the TwiML that answers; `statusCallback` hears when the dialled leg completes.
 */
export function dial(
  number: string,
  opts: { timeout?: number; statusCallback?: string; callerId?: string; action?: string } = {},
): string {
  const numberAttrs = opts.statusCallback
    ? attrs({ statusCallback: opts.statusCallback, statusCallbackMethod: 'POST', statusCallbackEvent: 'completed' })
    : ''
  const dialAttrs = attrs({
    action: opts.action,
    method: opts.action ? 'POST' : undefined,
    answerOnBridge: 'true',
    timeout: opts.timeout ?? 30,
    callerId: opts.callerId,
  })
  return `<Dial${dialAttrs}><Number${numberAttrs}>${xmlEscape(number)}</Number></Dial>`
}

/** Hand the call's audio to the bridge. Twilio sends no headers on a stream, so identity rides as parameters. */
export function connectStream(url: string, parameters: Record<string, string>): string {
  const params = Object.entries(parameters)
    .map(([name, value]) => `<Parameter${attrs({ name })} value="${xmlEscape(value)}"/>`)
    .join('')
  return `<Connect><Stream${attrs({ url })}>${params}</Stream></Connect>`
}

/**
 * Where the bridge's websocket is. Empty means it isn't deployed, and the line just forwards.
 *
 * The token goes in the PATH, not a query string: Twilio does not preserve query parameters on a
 * <Stream url="...">, so a token there is silently dropped and every real call falls through to the person
 * (client-phone-system trap 1; synthetic tests pass because they open the socket themselves).
 */
export function bridgeStreamUrl(): string | null {
  const base = (process.env.VOICE_BRIDGE_URL || '').trim().replace(/\/+$/, '')
  if (!base) return null
  const token = (process.env.VOICE_BRIDGE_TOKEN || '').trim()
  const wss = base.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:')
  return token ? `${wss}/twilio/${encodeURIComponent(token)}` : `${wss}/twilio`
}

export function phoneAiEnabled(): boolean {
  return process.env.PHONE_AI_ENABLED !== 'false' && Boolean(bridgeStreamUrl())
}

// ── live call control ───────────────────────────────────────────────────────

type FetchLike = typeof fetch

/** Replace a live call's TwiML (how a transfer happens mid-call). True when Twilio accepted it. */
export async function updateLiveCall(callSid: string, twimlBody: string, fetchImpl: FetchLike = fetch): Promise<boolean> {
  const cfg = phoneConfig()
  if (!cfg.accountSid || !cfg.authToken || !/^CA[a-fA-F0-9]{32}$/.test(callSid)) return false
  const res = await fetchImpl(
    `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Calls/${callSid}.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ Twiml: twimlBody }).toString(),
      signal: AbortSignal.timeout(8_000),
    },
  )
  if (!res.ok) console.error('[phone] Twilio refused the call update:', res.status)
  return res.ok
}

/** "+14705550123" -> "(470) 555-0123" for subjects a person reads; anything else comes back as given. */
export function prettyPhone(raw: string | null | undefined): string {
  const digits = String(raw || '').replace(/\D/g, '')
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  return ten.length === 10 ? `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}` : String(raw || '').trim()
}
