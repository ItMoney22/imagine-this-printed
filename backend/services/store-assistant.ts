// A seller's store assistant (David 2026-10-26: "build an assistant for her. It can use Gemini 3.8. Both have voice and
// text. So it responds TTS, Gemini TTS" ... "needs to have memory built in" ... "she should be able to upload images and
// the assistant can assess the design to create a product out of it"). Gemini 3.8 Flash straight to Google on
// GOOGLE_API_KEY (ITP's own key, the same one voiceGenerator.ts speaks with); never OpenRouter. A voice note or a picture
// goes in as inline data, so one call hears or sees her and answers: the reply comes back as JSON
// { heard, reply, remember, makeProduct }. Speaking the reply is voiceGenerator's 'store-assistant' persona. Called from
// routes/vendor-store.ts with facts read from her store and what it remembered, so it never guesses.

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
  /** What the assistant chose to remember about her in earlier chats, newest first. */
  memories?: string[]
}

/** A picture she attached: what Gemini sees, plus the facts a printer cares about. */
export type AssistantImage = { mimeType: string; data: string; widthPx: number; heightPx: number; transparent: boolean }

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
    `How it works: she makes and ships her own products and Imagine This Printed keeps ${f.feePercent} percent of those sales. Imagine This Printed products she sells are made and shipped by Imagine This Printed; it keeps its price to her and she keeps the rest. Buyers pay through Imagine This Printed's secure checkout and Stripe sends her share to her bank once payouts are set up. The AI design tools (Create a design, Make an image) cost ITC credits, shown in her Credits card; she buys more with Buy credits.`,
    'When she sends a picture of a design, look it over like a print shop would: what it is, whether it will print well (its size in pixels, a clear background, bold colours, nothing cut off), what it would sell well on, a product name and a price idea. If it could become a product, set makeProduct to true: she then presses Make it a product and the design studio takes it from there (mockups, photos and the listing; each step costs a few ITC credits).',
    'Use only the facts below for numbers. Never invent sales, orders, prices or buyers. If something is not in the facts, say you do not see it.',
    'You cannot change anything yourself. When she wants to change a price, add a product or set up payouts, tell her which card on this page does it.',
    'Memory: put in "remember" only lasting facts worth knowing next time (her style, her customers, plans, dates, names, what she likes or dislikes), at most two short sentences, written about her in the third person. Leave it empty for small talk.',
    'Keep replies short and warm: two to four sentences, unless she asks for a description or a caption. Plain text: no markdown, no asterisks, no headings.',
    'Never name the AI model or company behind you. You are her store assistant.',
    '',
    'FACTS',
    storeBrief(f),
    ...(f.memories?.length ? ['', 'WHAT YOU REMEMBER ABOUT HER', ...f.memories.map(m => `- ${m}`)] : []),
  ].join('\n')
}

type GeminiPart = { text?: string; inlineData?: { mimeType: string; data: string } }

/** The request body: her chat so far, her picture on her last message, and her voice note (if any) as the last turn. */
export function assistantBody(f: StoreFacts, turns: AssistantTurn[], audio?: { mimeType: string; data: string }, image?: AssistantImage) {
  const contents: Array<{ role: 'user' | 'model'; parts: GeminiPart[] }> = turns.slice(-16).map(t => ({
    role: t.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: t.text.slice(0, 4000) }],
  }))
  if (image) {
    const parts: GeminiPart[] = [
      { inlineData: { mimeType: image.mimeType, data: image.data } },
      { text: `(She attached this picture: ${image.widthPx} x ${image.heightPx} px, ${image.transparent ? 'clear background' : 'solid background'}.)` },
    ]
    const last = contents[contents.length - 1]
    if (last?.role === 'user') last.parts.unshift(...parts)
    else contents.push({ role: 'user', parts })
  }
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
        properties: {
          heard: { type: 'STRING' },
          reply: { type: 'STRING' },
          remember: { type: 'ARRAY', items: { type: 'STRING' } },
          makeProduct: { type: 'BOOLEAN' },
        },
        required: ['reply'],
      },
    },
  }
}

export type AssistantAnswer = { heard: string | null; reply: string; remember: string[]; makeProduct: boolean; usage: unknown }

/** One assistant turn. `heard` is what she said in a voice note (null for a typed message). */
export async function askStoreAssistant(
  f: StoreFacts,
  turns: AssistantTurn[],
  audio?: { mimeType: string; data: string },
  image?: AssistantImage
): Promise<AssistantAnswer> {
  const key = process.env.GOOGLE_API_KEY
  if (!key) throw new Error('GOOGLE_API_KEY is not configured')
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${STORE_ASSISTANT_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify(assistantBody(f, turns, audio, image)),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; usageMetadata?: unknown }
  const raw = (j.candidates?.[0]?.content?.parts ?? []).map(p => p.text ?? '').join('').trim()
  let out: { heard?: string; reply?: string; remember?: unknown; makeProduct?: unknown } = {}
  try {
    out = JSON.parse(raw)
  } catch {
    out = { reply: raw }
  }
  const reply = String(out.reply ?? '').trim()
  if (!reply) throw new Error('The assistant had nothing to say')
  const remember = Array.isArray(out.remember)
    ? out.remember.map(r => String(r).trim()).filter(r => r.length >= 3 && r.length <= 300).slice(0, 2)
    : []
  return {
    heard: audio ? String(out.heard ?? '').trim() || null : null,
    reply,
    remember,
    makeProduct: !!image && out.makeProduct === true,
    usage: j.usageMetadata ?? null,
  }
}
