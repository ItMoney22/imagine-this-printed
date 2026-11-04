// =============================================================================
// /api/phone — Imagine This Printed's phone line, (470) 227-8666 (task 20d54c05,
// David 2026-10-30: "ITP needs to be the (470) 227-8666 number").
//
// The number lives on the MetaSphere Marketing Twilio account and is answered by
// the shared MetaSphere voice bridge on Fly, the same one that answers Darrell's
// line (client-phone-system skill; reference: Darrell V2's src/app/api/phone/*).
//
//   caller -> Twilio -> POST /twilio/incoming   mints a call-scoped token
//          -> <Connect><Stream wss://bridge/twilio/TOKEN>  Mr. Imagine answers
//             <Dial>PHONE_FORWARD_TO</Dial>     the fallback: a dead bridge rings the shop
//          -> bridge asks POST /agent/session, runs /agent/tool, reports /agent/heartbeat
//             and /agent/transcript, each with the token minted for that call
//   texter -> Twilio -> POST /twilio/sms        becomes a support ticket (services/phone-agent.ts)
//
// Twilio's own requests carry X-Twilio-Signature; the bridge's carry the call token
// (lib/phone-agent-token.ts). Nothing here answers anyone else.
// =============================================================================
import { Router, type Request, type Response } from 'express'
import { supabase } from '../lib/supabase.js'
import { authorizeAgentRequest, mintCallToken } from '../lib/phone-agent-token.js'
import { PHONE_GREETING, PHONE_TOOLS, buildPhoneInstructions } from '../lib/phone-agent-persona.js'
import {
  GEMINI_LIVE_CONSTRAINED_WS,
  PHONE_GEMINI_LIVE_MODEL,
  mintPhoneLiveToken,
  phoneGeminiVoice,
  phoneUsesGemini,
} from '../lib/phone-gemini.js'
import {
  bridgeStreamUrl,
  connectStream,
  dial,
  phoneAiEnabled,
  phoneConfig,
  phonePublicBase,
  say,
  twiml,
  updateLiveCall,
  validTwilioSignature,
} from '../lib/phone-twilio.js'
import {
  dialWasMissed,
  fileCallTranscript,
  fileMissedCall,
  fileTextMessage,
  missedCallTwiml,
  runPhoneTool,
  type PhoneDeps,
} from '../services/phone-agent.js'
import { triageTicket } from '../lib/jev-triage.js'
import { sendNewSupportTicketEmail } from '../utils/email.js'
import { escapeHtml, pingChristinaAboutTicket } from '../services/support-ping.js'
import { bulkQuoteAlertRecipients } from './support.js'

export const PHONE_TENANT = 'imaginethisprinted'

const str = (v: unknown) => (typeof v === 'string' ? v : '')

function requestOrigin(req: Request): string {
  return `${req.protocol}://${req.get('host')}`
}

/** Twilio's form params when its signature checks out against the URL it called; null otherwise. */
function signedTwilioForm(req: Request): Record<string, string> | null {
  const cfg = phoneConfig()
  const params = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, string>
  const url = `${phonePublicBase(requestOrigin(req))}${req.originalUrl}`
  return validTwilioSignature(cfg.authToken, req.get('x-twilio-signature'), url, params) ? params : null
}

function sendXml(res: Response, body: string): void {
  res.status(200).set({ 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'no-store' }).send(body)
}

const agentHeaders = (req: Request) => ({ get: (name: string) => req.get(name) ?? null })

/** Where Twilio posts a Dial's result; a missed one becomes a ticket with the caller's number. */
function dialDoneUrl(): string {
  return `${phonePublicBase()}/api/phone/twilio/dial-done`
}

/** The TwiML for a new inbound call. Pure apart from env, so the shape is tested. */
export function incomingCallTwiml(params: Record<string, string>): string {
  const cfg = phoneConfig()
  if (!cfg.ready) return twiml(say('This phone line is not available right now. Please try again later.') + '<Hangup/>')

  // <Connect> returns when the bridge's socket closes, so a bridge that is down, refuses the session or is mid
  // deploy falls straight through to the <Dial>: losing Mr. Imagine never means losing the call.
  let stream = ''
  const streamUrl = phoneAiEnabled() ? bridgeStreamUrl() : null
  if (streamUrl) {
    try {
      stream = connectStream(streamUrl, {
        callSid: params.CallSid || '',
        from: params.From || '',
        to: params.To || '',
        // The bridge is shared by every MetaSphere client: this tells it which site the call is for, and the
        // token (minted here, bound to this call, 45 minutes) is all it can show that site.
        appUrl: phonePublicBase(),
        callToken: mintCallToken(params.CallSid || ''),
      })
    } catch (err) {
      // PHONE_AGENT_SECRET unset: no token, so no assistant. The call still rings the shop.
      console.error('[phone] no call token, forwarding only:', err instanceof Error ? err.message : String(err))
    }
  }
  return twiml(stream + dial(cfg.forwardTo, { timeout: 30, action: dialDoneUrl() }))
}

export function createPhoneRouter(deps: PhoneDeps): Router {
  const router = Router()

  router.post('/twilio/incoming', async (req: Request, res: Response) => {
    const params = signedTwilioForm(req)
    if (!params) return void res.status(403).json({ error: 'invalid signature' })
    // Answer first: the caller is listening to ringing while this runs.
    sendXml(res, incomingCallTwiml(params))
    if (params.CallSid) {
      const { error } = await deps.db.from('phone_calls').upsert(
        { call_sid: params.CallSid, from_number: params.From || null, to_number: params.To || null, status: 'ringing', updated_at: new Date().toISOString() },
        { onConflict: 'call_sid' },
      )
      if (error) console.error('[phone] could not record the call:', error.message)
    }
  })

  router.post('/twilio/dial-done', (req: Request, res: Response) => {
    const params = signedTwilioForm(req)
    if (!params) return void res.status(403).json({ error: 'invalid signature' })
    const missed = dialWasMissed(params.DialCallStatus)
    sendXml(res, missed ? missedCallTwiml() : twiml('<Hangup/>'))
    if (missed) {
      void fileMissedCall({ callSid: params.CallSid || '', from: params.From || '', reason: str(req.query.reason) }, deps).catch((err) =>
        console.error('[phone] missed-call ticket failed:', err instanceof Error ? err.message : String(err)),
      )
    }
  })

  router.post('/twilio/status', async (req: Request, res: Response) => {
    const params = signedTwilioForm(req)
    if (!params) return void res.status(403).json({ error: 'invalid signature' })
    // Each call reports two legs (inbound + a forwarded leg); only the parent is the call.
    if (params.CallSid && !params.ParentCallSid) {
      const duration = Number.parseInt(params.CallDuration || '', 10)
      const { error } = await deps.db.from('phone_calls').upsert(
        {
          call_sid: params.CallSid,
          from_number: params.From || null,
          to_number: params.To || null,
          status: params.CallStatus || null,
          duration_seconds: Number.isFinite(duration) ? duration : null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'call_sid' },
      )
      if (error) console.error('[phone] could not record the call status:', error.message)
      if (params.CallStatus === 'completed') {
        void fileCallTranscript(params.CallSid, deps).catch((err) =>
          console.error('[phone] transcript filing failed:', err instanceof Error ? err.message : String(err)),
        )
      }
    }
    res.json({ received: true })
  })

  router.post('/twilio/sms', (req: Request, res: Response) => {
    const params = signedTwilioForm(req)
    if (!params) return void res.status(403).json({ error: 'invalid signature' })
    // No reply: the number cannot text out (A2P campaign rejected), so an auto-answer would only fail.
    sendXml(res, twiml(''))
    const count = Math.min(Number.parseInt(params.NumMedia || '0', 10) || 0, 10)
    const mediaUrls = Array.from({ length: count }, (_, i) => params[`MediaUrl${i}`]).filter(Boolean)
    void fileTextMessage({ from: params.From || '', body: params.Body || '', mediaUrls, messageSid: params.MessageSid || '' }, deps).catch((err) =>
      console.error('[phone] text could not be filed:', params.MessageSid, err instanceof Error ? err.message : String(err)),
    )
  })

  router.post('/agent/session', async (req: Request, res: Response) => {
    const callSid = str(req.body?.callSid)
    const auth = authorizeAgentRequest(agentHeaders(req), callSid || null)
    if (!auth.ok) return void res.status(403).json({ error: 'forbidden', reason: auth.reason })

    // Gemini 3.8 Live is the only model. A token that will not mint refuses the session, and the call falls
    // through to the <Dial> after the <Connect>: it rings the shop.
    const liveToken = phoneUsesGemini() ? await mintPhoneLiveToken() : null
    res.set('Cache-Control', 'no-store')
    if (!liveToken) return void res.status(503).json({ error: 'voice_unavailable', reason: 'gemini_token' })
    res.json({
      instructions: buildPhoneInstructions(str(req.body?.from)),
      voice: phoneGeminiVoice(),
      greeting: PHONE_GREETING,
      tools: PHONE_TOOLS,
      model: PHONE_GEMINI_LIVE_MODEL,
      voiceProvider: 'gemini',
      credentials: { token: liveToken, wsUrl: GEMINI_LIVE_CONSTRAINED_WS },
      tenant: PHONE_TENANT,
    })
  })

  router.post('/agent/tool', async (req: Request, res: Response) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    // Bound to this exact call, so a leaked token cannot act on another one.
    const auth = authorizeAgentRequest(agentHeaders(req), str(body.callSid) || null)
    if (!auth.ok) return void res.status(403).json({ ok: false, speak: '', reason: auth.reason })
    const tool = str(body.tool)
    if (!tool) return void res.status(400).json({ ok: false, speak: "I can't do that one." })
    try {
      const args = body.args && typeof body.args === 'object' ? body.args : {}
      res.set('Cache-Control', 'no-store').json(await runPhoneTool(tool, args, str(body.callSid), str(body.from), deps))
    } catch (err) {
      // Mr. Imagine is mid-sentence with a real person. Give him something to say.
      console.error(`[phone] tool ${tool} threw:`, err instanceof Error ? err.message : String(err))
      res.json({ ok: false, speak: "I couldn't do that just now, but I've got you." })
    }
  })

  router.post('/agent/heartbeat', async (req: Request, res: Response) => {
    const callSid = str(req.body?.callSid)
    const auth = authorizeAgentRequest(agentHeaders(req), callSid || null)
    if (!auth.ok) return void res.status(403).json({ ok: false, reason: auth.reason })
    const seconds = Number(req.body?.aiSeconds)
    if (!callSid || !Number.isFinite(seconds)) return void res.status(400).json({ ok: false })
    // Upsert, never update: Twilio only reports the call when it ends, so the row may not exist yet.
    const { error } = await deps.db
      .from('phone_calls')
      .upsert({ call_sid: callSid, ai_seconds: Math.max(0, Math.round(seconds)), updated_at: new Date().toISOString() }, { onConflict: 'call_sid' })
    if (error) {
      console.error('[phone] heartbeat failed:', error.message)
      return void res.status(500).json({ ok: false })
    }
    res.json({ ok: true })
  })

  router.post('/agent/transcript', async (req: Request, res: Response) => {
    const callSid = str(req.body?.callSid)
    const auth = authorizeAgentRequest(agentHeaders(req), callSid || null)
    if (!auth.ok) return void res.status(403).json({ ok: false, reason: auth.reason })
    const speaker = req.body?.speaker === 'caller' || req.body?.speaker === 'assistant' ? req.body.speaker : null
    const text = str(req.body?.text).trim().slice(0, 4000)
    const seq = Number(req.body?.seq)
    if (!callSid || !speaker || !text || !Number.isInteger(seq)) return void res.status(400).json({ ok: false })
    // The unique (call_sid, seq) makes a retried turn a no-op instead of a duplicate line.
    const { error } = await deps.db
      .from('phone_call_turns')
      .upsert({ call_sid: callSid, speaker, text, seq }, { onConflict: 'call_sid,seq', ignoreDuplicates: true })
    if (error) {
      console.error('[phone] transcript turn failed:', error.message)
      return void res.status(500).json({ ok: false })
    }
    res.json({ ok: true })
  })

  return router
}

export default createPhoneRouter({
  db: supabase,
  triage: (t) => triageTicket(t),
  // A text or a spoken name is whatever the caller sent: keep it text in the HTML email.
  emailTeam: (ticketId, subject, description, priority, category, from, to) =>
    sendNewSupportTicketEmail(ticketId, escapeHtml(subject), escapeHtml(description), priority, category, from, to),
  bulkRecipients: bulkQuoteAlertRecipients,
  ping: (p) => pingChristinaAboutTicket(p),
  updateCall: (callSid, body) => updateLiveCall(callSid, body),
})
