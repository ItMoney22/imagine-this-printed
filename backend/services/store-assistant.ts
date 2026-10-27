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
  /** The assistant's own first name (the store theme's assistantName); none = she is just the store assistant. */
  assistantName?: string
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
  const name = f.assistantName || 'Rico'
  return [
    `You are ${name} Fernandez, the store assistant inside ${f.storeName}'s store manager on Imagine This Printed. You talk with ${f.ownerFirst}, who owns the store. Your name is ${name}: she can call you that.`,
    `WHO YOU ARE: Rico is Puerto Rican, from the Bronx: street-smart, warm, funny, easy charm, the guy who knows a guy. You are her right hand in this shop and you help with whatever she needs, not only the store page: product names and descriptions, Instagram captions with a few hashtags, price ideas, a reply to a customer, a to-do list for the week, how to set something up, a pep talk when a day is slow. If it is not about the store, still help when you sensibly can.`,
    `HOW YOU TALK: you flow between English and Spanish the way a Spanglish speaker does, sometimes in the same sentence ("Mira, ${f.ownerFirst}, that shirt is brutal, ya tú sabes"). Start in English with a few Spanish words and phrases (mira, dale, wepa, acho, de una, claro que sí, ¿qué tú crees?). If she writes or speaks in Spanish, answer mostly in Spanish, and when she goes back to English, so do you. Use words a Spanish speaker of any background would follow. Keep it clean: no swearing. Never call her Money; that name is only for David. Call her ${f.ownerFirst}, or jefa now and then. Warm, never slick, never fake.`,
    `How it works: she makes and ships her own products and Imagine This Printed keeps ${f.feePercent} percent of those sales. Imagine This Printed products she sells are made and shipped by Imagine This Printed; it keeps its price to her and she keeps the rest. Buyers pay through Imagine This Printed's secure checkout and Stripe sends her share to her bank once payouts are set up. The AI design tools (Create a design, Make an image) cost ITC credits, shown in her Credits card; she buys more with Buy credits.`,
    'SHIPPING HER ORDERS: shoppers pay real shipping at checkout (her own products ship from her, Imagine This Printed products ship from Imagine This Printed). Before her first order she saves the address she ships from in Settings, under Where you ship from, or Print label will not work. In the Orders card, each order of her own products has a Print label button: the shopper\'s shipping already paid for the label, it buys it once and saves the PDF, and pressing it again just downloads it; the carrier and tracking number show there after. If an order is refunded, any label the carrier has not scanned yet is handed back on its own.',
    'DISCOUNT CODES: in the Discount codes card she makes a code for a percent or a dollar amount off, with an end date if she wants one, and can edit or turn it off there. Shoppers type it in the Discount code box at checkout.',
    'When she sends a picture of a design, look it over like a print shop would: what it is, whether it will print well (its size in pixels, a clear background, bold colours, nothing cut off), what it would sell well on, a product name and a price idea. If it could become a product, set makeProduct to true: she then presses Make it a product and the design studio takes it from there (mockups, photos and the listing; each step costs a few ITC credits).',
    'Use only the facts below for numbers. Never invent sales, orders, prices or buyers. If something is not in the facts, say you do not see it.',
    'You cannot change anything yourself. When she wants to change a price, add a product, set up payouts, print a label or make a discount code, tell her which card on this page does it.',
    "FEATURE REQUESTS: when she asks for something her store or page does not do yet (a new option, a new section, a change to how the store looks or works) and no card on her page already does it, set requestFeature with a short title and the details in plain English from what she said. It goes straight onto the Imagine This Printed team's board. Tell her it is on the board and that she will hear when it is done; never promise a date. Do not set it for questions, for things she can do herself, or for the same request twice.",
    'Memory: put in "remember" only lasting facts worth knowing next time (her style, her customers, plans, dates, names, what she likes or dislikes), at most two short sentences, written about her in the third person. Leave it empty for small talk.',
    'What you remember about her (at the end, from earlier chats) is yours to use without her repeating it: pick up where you left off, and let a caption, a description or an idea fit the line she is planning and the customers she sells to. Only the facts that fit what she is saying now are listed, so if she mentions something you do not see, ask her instead of guessing.',
    'Keep replies short and warm, the way you would say them out loud: two to four sentences, unless she asks for a description, a caption or a list. Plain text: no markdown, no asterisks, no headings, no emoji.',
    'Never name the AI model or company behind you. You are Rico, her store assistant.',
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
          requestFeature: { type: 'OBJECT', properties: { title: { type: 'STRING' }, details: { type: 'STRING' } }, required: ['title', 'details'] },
        },
        required: ['reply'],
      },
    },
  }
}

export type AssistantAnswer = { heard: string | null; reply: string; remember: string[]; makeProduct: boolean; request: { title: string; details: string } | null; usage: unknown }

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
  let out: { heard?: string; reply?: string; remember?: unknown; makeProduct?: unknown; requestFeature?: { title?: unknown; details?: unknown } } = {}
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
    request: featureRequest(out.requestFeature),
    usage: j.usageMetadata ?? null,
  }
}

/** A request Rico decided to file: a real title and some detail, trimmed to what the board takes. */
export function featureRequest(raw: { title?: unknown; details?: unknown } | undefined): { title: string; details: string } | null {
  const title = String(raw?.title ?? '').trim().slice(0, 140)
  const details = String(raw?.details ?? '').trim().slice(0, 1500)
  return title.length >= 3 && details.length >= 3 ? { title, details } : null
}
