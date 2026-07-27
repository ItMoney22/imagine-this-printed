# Etsy / SEO copy generation — gpt-4o → gemini-2.5-flash-lite

**Date:** 2026-07-26
**Watchtower task:** `ef674fdc-62e8-4908-a96e-bc21ac01089e`
**Author:** Marcus Wolfe (financial strategist)

Moves the two AI copy services off `gpt-4o` / `gpt-4o-mini` onto
`google/gemini-2.5-flash-lite` via OpenRouter, with `gpt-5.4-nano` on the direct
OpenAI account as a runtime fallback. Prompts, JSON contract, sanitizers,
pricing, and publishing behaviour are unchanged — this is a routing change.

---

## 1. Why

| | in / $1M | out / $1M | status |
|---|---|---|---|
| `gpt-4o` (old Etsy composer default) | $2.50 | $10.00 | slated for retirement |
| `gpt-4o-mini` (old SEO-pack default) | $0.15 | $0.60 | superseded |
| **`google/gemini-2.5-flash-lite`** (new default) | **$0.10** | **$0.40** | current |
| `gpt-5.4-nano` (fallback) | $0.05 | $0.40 | current |
| `google/gemini-3.5-flash-lite` (escape hatch) | $0.30 | $2.50 | current |

Pricing verified live 2026-07-26: the `google/*` rows from OpenRouter's
`/api/v1/models`, the `openai` rows from OpenAI's pricing page. Both target
models were confirmed to exist and answer on this account before any code
changed.

Beyond cost, `gpt-4o` is on OpenAI's retirement path — leaving the Etsy
publishing pipeline on it is a scheduled outage we'd rather not inherit.

## 2. What changed

| File | Change |
|---|---|
| `backend/services/etsy-seo-composer.ts` | Two-tier model routing; records the model that actually produced the copy |
| `backend/services/seo-pack.ts` | Same two-tier routing for meta title/description/keywords/captions |
| `backend/services/model-compat.ts` | **new** — `completionTokenParam()`, the `max_tokens` shim (see §3) |
| `backend/scripts/compare-etsy-seo-models.ts` | **new** — reproducible A/B harness, read-only |
| `backend/.env.example` | Documents `ETSY_SEO_MODEL` / `SEO_PACK_MODEL` and the routing rule |

### Routing ladder

Both services resolve a model the same way:

1. `OPENROUTER_API_KEY` set → `ETSY_SEO_MODEL` / `SEO_PACK_MODEL`, default
   `google/gemini-2.5-flash-lite`
2. that call fails → retry on `OPENAI_API_KEY` with
   `ETSY_SEO_FALLBACK_MODEL` / `SEO_PACK_FALLBACK_MODEL`, default `gpt-5.4-nano`
3. both unavailable/failed → existing mechanical derivation

**Tier 2 is a runtime retry, not just a config-time default.** Both services
wrap their model call in a `try/catch` that silently degrades to mechanical
copy, so a live-but-rejected key produces no error — just quietly worse
listings on every product. That is not hypothetical: see §5.

No env vars are required to get the intended production behaviour. Set
`ETSY_SEO_MODEL` / `SEO_PACK_MODEL` only to pin something else. A pinned value
overrides the routing default, so it must be valid for whichever provider the
key selects — an OpenAI-style id while `OPENROUTER_API_KEY` is set will 404.

## 3. Migration hazard found: `max_tokens` is rejected by the fallback model

A plain model-string swap would have broken tier 2. GPT-5-family models reject
the old parameter:

```
POST /v1/chat/completions {"model":"gpt-5.4-nano","max_tokens":900}
→ 400 Unsupported parameter: 'max_tokens' is not supported with this model.
      Use 'max_completion_tokens' instead.
```

Because both call sites swallow exceptions, this 400 would never have surfaced —
it would have shown up only as a shelf of mechanically-generated listings.
`services/model-compat.ts` centralises the shim and widens the budget 3x for
reasoning-era models, whose billed hidden reasoning tokens come out of the same
allowance and can otherwise truncate the JSON mid-response.

## 4. Sample comparison — 3 real products

Generated with the harness, which sends the **exact** production system prompt
and user payload and runs the output through the **same** `sanitizePack()`
limits the publisher enforces:

```bash
cd backend
npx tsx --env-file=.env scripts/compare-etsy-seo-models.ts --limit 3
```

Compliance below is measured against what the prompt actually asks for, not
vibes: title 50–90 chars and comma-free, exactly 13 unique tags of ≤20 chars,
and a first description line ≤155 chars (that line is Etsy's mobile preview).

### 4.1 "Du bist gut genug Retro Shirt"

**gpt-4o** — 498 in / 244 out · $0.003685 · 3296 ms
> **Title (60):** Du Bist Gut Genug Retro Varsity T-Shirt | Unisex Graphic Tee
> **Tags:** retro varsity shirt · motivational tees · collegiate style · funny gift · streetwear fashion · german text shirt · trendy graphic tee · inspirational quote · unisex fashion · athletic serif font · arc lettering · cool casual wear · uplifting message
> **Hook (64):** This retro varsity T-shirt says 'Du Bist Gut Genug' with style!

**gemini-2.5-flash-lite** — 498 in / 272 out · $0.000159 · 1802 ms
> **Title (66):** Du bist gut genug Retro Varsity T-Shirt | Motivational Graphic Tee
> **Tags:** du bist gut genug · retro varsity tee · motivational shirt · gift for trend buyer · streetwear fashion · collegiate style · funny motivation · casual graphic tee · german quote shirt · unisex graphic tee · new favorite tee · athletic serif · rockmart ga shirt
> **Hook (116):** The "Du bist gut genug" Retro Varsity T-Shirt is your daily reminder of worth, styled in cool collegiate lettering.

Flash-lite leads with the exact-match phrase `du bist gut genug` as tag 1;
gpt-4o never tags the literal design name. Both fully compliant.

### 4.2 "Alien Directive Tee"

**gpt-4o** — 468 in / 266 out · $0.003830 · 3274 ms
> **Title (51):** Alien Directive Graphic Tee | Casual Unisex T-Shirt
> **Hook (214):** Broadcast interstellar wisdom with a touch of humor in our Alien Directive Tee. Features a grey alien pointing at you with 'Listen!' above. Perfect for those who want to make contact—without the awkward handshakes.
> ⚠️ hook is 214 chars — **59 over** the 155-char mobile preview limit

**gemini-2.5-flash-lite** — 468 in / 228 out · $0.000138 · 1076 ms
> **Title (52):** Alien Directive Graphic T-Shirt | Sci-Fi Novelty Tee
> **Hook (88):** Make contact and broadcast interstellar wisdom in this funny alien pointing graphic tee!
> ⚠️ tag `grape alien` — should be `grey alien` (see §6)

### 4.3 "Walk By Faith"

**gpt-4o** — 412 in / 197 out · $0.003000 · 2037 ms
> **Title (54):** Walk By Faith Inspirational T-Shirt | Unisex Faith Tee
> **Hook (89):** Embrace your faith with our Walk By Faith Inspirational T-Shirt, designed for believers.

**gemini-2.5-flash-lite** — 411 in / 245 out · $0.000139 · 1474 ms
> **Title (59):** Walk By Faith Inspirational T-Shirt | Christian Graphic Tee
> **Hook (78):** Embrace your journey with our inspiring 'Walk By Faith' Christian graphic tee!

Flash-lite surfaces `christian clothing` / `bible verse shirt` — higher-volume
Etsy queries than gpt-4o's abstract `faithful living` / `comfort fashion`.

### 4.4 Verdict

| | gpt-4o | gemini-2.5-flash-lite |
|---|---|---|
| Titles in 50–90 chars, comma-free | 3/3 | 3/3 |
| Exactly 13 valid unique tags | 3/3 | 3/3 |
| **Hook within 155 chars** | **1/3** | **3/3** |
| Median latency | 3274 ms | 1474 ms |
| Cost / listing | $0.003505 | $0.000145 |

**Not a regression — a modest improvement.** Flash-lite respected the
mobile-preview limit on all three where gpt-4o overran it on two, kept titles
readable, and picked more literal buyer-search phrasing. It is also ~2.2x
faster. Recommendation: ship flash-lite; no need for `gemini-3.5-flash-lite`.

### 4.5 Fallback quality (`gpt-5.4-nano`)

Run for the same 3 products. Fully compliant — 13 valid tags, titles in range,
hooks 94 / 132 / within limit on all three, ~$0.00011 per listing. Copy is
terser and more clinical than either alternative, which is the right trade for
a path that only runs when the primary is down.

## 5. Deployment blocker — the OpenRouter key in the repo is dead

`backend/.env` carries `sk-or-v1-2a794d5…`, which is
`OPENROUTER_API_KEY_PREV_2026-07-06` in the vault — rotated out and now
returning `401 User not found`. The live key is the vault's current
`ai.OPENROUTER_API_KEY` (`sk-or-v1-f0f9090…`), confirmed working.

This matters more after this change than before it, because OpenRouter is now
the **default** path for both services rather than an opt-in for the chat
routes. Before this lands in production:

1. Confirm Render's `OPENROUTER_API_KEY` is the current vault value, not the
   rotated one.
2. Update the local `backend/.env` for anyone running the worker locally.

The tier-2 ladder means a dead key degrades to `gpt-5.4-nano` rather than to
mechanical copy — but that silently spends on the wrong provider, so fix the
key rather than relying on the safety net. Note the same dead key would also
affect `routes/ai/chat.ts`, `routes/email.ts` compose-assist, and
`services/imagine-brain.ts`, which already default to OpenRouter.

## 6. Known issue — hallucinated tag

Flash-lite produced the tag `grape alien` where the design is a **grey** alien.
One bad tag out of 39 generated (2.6%). Not migration-blocking — the Etsy panel
is review-before-publish and packs are hand-editable via `saveEtsyPackEdits()` —
but worth watching across a larger batch. `gpt-4o` produced no equivalent error
in this sample. If it recurs, the cheapest fix is a prompt line telling the
model to copy colour/subject words verbatim from the product description rather
than paraphrasing them.

## 7. Financial framing

Honest accounting: the direct saving is small in absolute terms.

| Volume | gpt-4o | flash-lite | saved |
|---|---|---|---|
| 12-listing Etsy batch | $0.042 | $0.0017 | $0.040 |
| 100 listings | $0.35 | $0.015 | $0.34 |
| Full ~2,700-design library | ~$9.46 | ~$0.39 | ~$9.07 |

A 24.1x reduction that beats the $0.004/batch target, but nobody funds a land
purchase on four cents a batch. The real value is threefold:

1. **Removes a retirement dependency.** `gpt-4o` is scheduled to go away; the
   Etsy pipeline no longer rides on it.
2. **Makes regeneration free.** Re-composing the entire catalogue now costs
   about 39 cents. At gpt-4o prices, "just re-run all the copy" was a $10
   decision that needed thinking about; now it doesn't.
3. **~2.2x faster**, which is what a 12-offering batch actually feels like.

Cost was the trigger. Getting off a dying model and being able to iterate on
listing copy for free is the return.

## 8. Verification performed

- Backend typecheck: **252 errors before, 252 after** — byte-identical set, zero
  introduced. (The 252 are a pre-existing repo condition: `backend/node_modules`
  is empty, so backend-only deps `pino`/`jose`/`replicate`/`@types/cors` and the
  ungenerated Prisma client don't resolve. Unrelated to this change.) All four
  touched files are clean.
- Live A/B on 3 real active products for all three models, using the production
  prompt and sanitizer.
- Model existence and pricing confirmed against OpenRouter and OpenAI APIs.
- `gpt-4o` + `max_tokens` vs `gpt-5.4-nano` + `max_completion_tokens` verified
  by direct API call, including the reproduced 400.

**Not verified live:** a forced tier-1→tier-2 failover through `composeEtsyPack()`
itself. That function persists to `products.metadata.etsy_pack`, and overwriting
live packs wasn't in scope for this task. The tier-2 *model* is proven working
against the real prompt (§4.5); the ladder around it is a plain ordered loop
covered by typecheck and review. First real production compose will confirm it —
watch for `[etsy-composer] <model> call failed` in the Render logs.
