// A seller's store assistant (David 2026-10-26: "build an assistant for her. It can use Gemini 3.8. Both have voice and
// text. So it responds TTS, Gemini TTS"). Gemini 3.8 Flash straight to Google on GOOGLE_API_KEY (ITP's own key, the
// same one voiceGenerator.ts speaks with); never OpenRouter. A voice note goes in as inline audio, so one call hears
// her and answers: the reply comes back as JSON { heard, reply }. Speaking the reply is voiceGenerator's
// 'store-assistant' persona. Called from routes/vendor-store.ts with facts read from her store, so it never guesses.

export const STORE_ASSISTANT_MODEL = process.env.STORE_ASSISTANT_MODEL || 'gemini-3.8-flash'

export type AssistantTurn = { role: 'user' | 'assistant'; text: string }
export type StoreFacts = {
  storeName: string
  ownerFirst: string
  status: string
  payoutsReady: boolean
  feePercent: number
  instagram: string | null
  items: Array<{ name: string; kind: 'own' | 'itp'; priceCents: number; itpCostCents: number; active: boolean }>
  orders: Array<{ createdAt: string; totalCents: number; shareCents: number | null }>
}

const usd = (c: number) => `$${(c / 100).toFixed(2)}`

/** Her store in plain lines: the only numbers the assistant may use. */
export function storeBrief(f: StoreFacts): string {
  const month = new Date().toISOString().slice(0, 7)
  const thisMonth = f.orders.filter(o => o.createdAt.startsWith(month))
  const lines = [
    `Store: ${f.storeName}. Owner: ${f.ownerFirst}. Status: ${f.status}${f.status === 'live' ? '' : ' (not taking orders yet)'}.`,
    `Payouts: ${f.payoutsReady ? 'set up' : 'not set up yet (she presses Set up payouts in the Payouts card)'}.`,
    `Instagram: ${f.instagram ? '@' + f.instagram : 'not added yet (Settings card)'}.`,
    `Orders this month: ${thisMonth.length}, sales ${usd(thisMonth.reduce((n, o) => n + o.totalCents, 0))}, her share ${usd(thisMonth.reduce((n, o) => n + (o.shareCents || 0), 0))}. All time: ${f.orders.length} orders.`,
    'Her products (she makes and ships these):',
    ...f.items.filter(i => i.kind === 'own').map(i => `- ${i.name}: ${usd(i.priceCents)}${i.active ? '' : ' (switched off)'}`),
    'Imagine This Printed products she can sell (ITP makes and ships them):',
    ...f.items.filter(i => i.kind === 'itp').map(i => `- ${i.name}: her price ${usd(i.priceCents)}, ITP's price to her ${usd(i.itpCostCents)}, she earns ${usd(i.priceCents - i.itpCostCents)}${i.active ? '' : ' (not on her store)'}`),
  ]
  return lines.join('\n')
}

export function systemPrompt(f: StoreFacts): string {
  return [
    `You are the store assistant inside ${f.storeName}'s store manager on Imagine This Printed. You talk with ${f.ownerFirst}, who owns the store.`,
    'Help her sell: write product names and descriptions, Instagram captions with a few hashtags, price ideas, and explain how her store works.',
    `How it works: she makes and ships her own products and Imagine This Printed keeps ${f.feePercent} percent of those sales. Imagine This Printed products she sells are made and shipped by Imagine This Printed; it keeps its price to her and she keeps the rest. Buyers pay through Imagine This Printed's secure checkout and Stripe sends her share to her bank once payouts are set up. The AI design tools (Design a shirt, Make an image) cost ITC credits, shown in her Credits card; she buys more with Buy credits.`,
    'Use only the facts below for numbers. Never invent sales, orders, prices or buyers. If something is not in the facts, say you do not see it.',
    'You cannot change anything yourself. When she wants to change a price, add a product or set up payouts, tell her which card on this page does it.',
    'Keep replies short and warm: two to four sentences, unless she asks for a description or a caption. Plain text: no markdown, no asterisks, no headings.',
    'Never name the AI model or company behind you. You are her store assistant.',
    '',
    'FACTS',
    storeBrief(f),
  ].join('\n')
}

type GeminiPart = { text?: string; inlineData?: { mimeType: string; data: string } }

/** The request body: her chat so far, and her voice note (if any) as the last turn. */
export function assistantBody(f: StoreFacts, turns: AssistantTurn[], audio?: { mimeType: string; data: string }) {
  const contents: Array<{ role: 'user' | 'model'; parts: GeminiPart[] }> = turns.slice(-16).map(t => ({
    role: t.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: t.text.slice(0, 4000) }],
  }))
  if (audio) contents.push({ role: 'user', parts: [{ inlineData: audio }, { text: '(She sent this as a voice note. Put exactly what she said in "heard".)' }] })
  return {
    systemInstruction: { parts: [{ text: systemPrompt(f) }] },
    contents,
    generationConfig: {
      temperature: 0.7,
      // Measured 2026-10-26: the default thinking took 9.6 s for a store question; "low" answers in about 1.6 s.
      thinkingConfig: { thinkingLevel: 'low' },
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: { heard: { type: 'STRING' }, reply: { type: 'STRING' } },
        required: ['reply'],
      },
    },
  }
}

/** One assistant turn. `heard` is what she said in a voice note (null for a typed message). */
export async function askStoreAssistant(
  f: StoreFacts,
  turns: AssistantTurn[],
  audio?: { mimeType: string; data: string }
): Promise<{ heard: string | null; reply: string; usage: unknown }> {
  const key = process.env.GOOGLE_API_KEY
  if (!key) throw new Error('GOOGLE_API_KEY is not configured')
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${STORE_ASSISTANT_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify(assistantBody(f, turns, audio)),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; usageMetadata?: unknown }
  const raw = (j.candidates?.[0]?.content?.parts ?? []).map(p => p.text ?? '').join('').trim()
  let out: { heard?: string; reply?: string } = {}
  try {
    out = JSON.parse(raw)
  } catch {
    out = { reply: raw }
  }
  const reply = String(out.reply ?? '').trim()
  if (!reply) throw new Error('The assistant had nothing to say')
  return { heard: audio ? String(out.heard ?? '').trim() || null : null, reply, usage: j.usageMetadata ?? null }
}
