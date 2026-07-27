// ---------------------------------------------------------------------------
// Cross-model chat-completion compatibility shims.
//
// Written 2026-07-26 during the Etsy/SEO gpt-4o -> gemini-2.5-flash-lite
// migration, because the reasoning-era OpenAI models changed the request
// contract out from under a plain model-string swap:
//
//   POST /v1/chat/completions {"model":"gpt-5.4-nano","max_tokens":900}
//   -> 400 "Unsupported parameter: 'max_tokens' is not supported with this
//           model. Use 'max_completion_tokens' instead."
//
// Every caller here already try/catches its model call and silently degrades
// to a mechanical fallback, so that 400 would NOT have thrown loudly — it
// would just have quietly produced worse copy on every listing. Hence a shared
// helper rather than an inline ternary per call site.
// ---------------------------------------------------------------------------

/** GPT-5 family + the o-series reasoning models take `max_completion_tokens`. */
const REASONING_ERA = /(^|\/)(gpt-5|o[1-4])([.\-]|$)/i

/**
 * Pick the right output-token parameter for `model`, and widen the ceiling for
 * reasoning models: their hidden reasoning tokens are billed and counted
 * against this same budget, so re-using the chat-era number risks the response
 * hitting `finish_reason: "length"` mid-JSON.
 */
export function completionTokenParam(
  model: string,
  budget: number
): { max_tokens: number } | { max_completion_tokens: number } {
  return REASONING_ERA.test(model) ? { max_completion_tokens: budget * 3 } : { max_tokens: budget }
}
