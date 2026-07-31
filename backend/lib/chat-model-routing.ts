// Cost routing for Mr. Imagine's OpenRouter brain.
//
// /api/ai/mr-imagine/chat is vision-capable, so it sent EVERY turn to
// google/gemini-2.5-pro the moment OPENROUTER_API_KEY existed — including the
// pure-text mascot chatter that is the overwhelming majority of turns. Pro is
// roughly 20x flash per token at the max_tokens this route uses (plus Gemini's
// hidden reasoning tokens, which are billed and come out of the same budget),
// so the site paid vision prices for one-sentence replies.
//
// The decision has to be made on what the outgoing payload ACTUALLY contains,
// not on a request flag. A client-supplied `hasImage` boolean is both spoofable
// and wrong whenever replayed conversation history carries an image part, and
// getting it wrong is asymmetric: routing a text turn to pro only burns money,
// but routing an image turn to a text-only model breaks vision outright. So we
// inspect the built messages array — the same object handed to the SDK.
//
// Model IDs are hardcoded constants rather than env vars, matching the sibling
// OpenRouter call sites (routes/ai/chat.ts:29-31, services/imagine-brain.ts:35).
// In this repo only the direct-OpenAI *fallback* IDs are env-configurable
// (OPENAI_TEXT_MODEL / OPENAI_VISION_MODEL), because those are the ones that
// get retired out from under us.

export const OPENROUTER_TEXT_MODEL = 'google/gemini-2.5-flash'
export const OPENROUTER_VISION_MODEL = 'google/gemini-2.5-pro'

/**
 * True if a single chat-completion content part is a usable image.
 *
 * A part with `type: 'image_url'` but a missing/blank url is not image content —
 * it would be dropped (or rejected) upstream, so paying pro prices for it is
 * pure waste. That case is reachable: the route builds refs from user-supplied
 * `imageUrl` / `imageUrls`, where a whitespace-only string survives `Boolean`.
 */
function isImagePart(part: unknown): boolean {
  if (!part || typeof part !== 'object') return false
  const candidate = part as { type?: unknown; image_url?: unknown }
  if (candidate.type !== 'image_url') return false
  const url = (candidate.image_url as { url?: unknown } | null | undefined)?.url
  return typeof url === 'string' && url.trim().length > 0
}

/**
 * True if any message in the payload carries image content.
 *
 * Plain-string content (the shape every text turn and every replayed history
 * entry currently uses) can never be an image, so it short-circuits to false.
 */
export function messagesContainImage(messages: unknown): boolean {
  if (!Array.isArray(messages)) return false
  return messages.some((message) => {
    const content = (message as { content?: unknown } | null | undefined)?.content
    return Array.isArray(content) && content.some(isImagePart)
  })
}

/**
 * Pick the OpenRouter model for a turn: pro only when the turn actually carries
 * an image, flash otherwise.
 */
export function pickOpenRouterChatModel(messages: unknown): string {
  return messagesContainImage(messages) ? OPENROUTER_VISION_MODEL : OPENROUTER_TEXT_MODEL
}
