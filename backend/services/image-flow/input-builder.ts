// Builds provider-specific input shapes from the unified image-flow request.
// Each model has its own parameter quirks — encapsulate them here so api/* stay clean.

import type { ImageModel } from './models.js'

export interface BuildInputOpts {
  prompt: string
  /** Reference / source images for edit or compositing. */
  inputImages?: string[]
  /** Caller-supplied native overrides merged last. */
  extra?: Record<string, unknown>
}

export function buildInput(model: ImageModel, opts: BuildInputOpts): Record<string, unknown> {
  const base: Record<string, unknown> = { prompt: opts.prompt }
  const refs = opts.inputImages ?? []

  switch (model.id) {
    // --- ITP default ---
    case 'openai/gpt-image-2': {
      // Replicate's openai/gpt-image-2 uses `input_images` (array). It's the same
      // endpoint for gen and edit — pass an empty array (or omit) for pure generation.
      base.aspect_ratio = '1:1'
      base.quality = 'high'
      base.output_format = 'png'
      base.background = 'auto'
      if (refs.length > 0) base.input_images = refs
      break
    }

    // --- Generation models ---
    case 'black-forest-labs/flux-schnell': {
      base.aspect_ratio = '1:1'
      base.output_format = 'png'
      base.num_inference_steps = 4
      break
    }
    case 'prunaai/z-image-turbo': {
      base.aspect_ratio = '1:1'
      break
    }
    case 'black-forest-labs/flux-1.1-pro':
    case 'black-forest-labs/flux-1.1-pro-ultra': {
      base.aspect_ratio = '1:1'
      base.output_format = 'png'
      break
    }
    case 'black-forest-labs/flux-2-pro':
    case 'black-forest-labs/flux-2-max': {
      base.aspect_ratio = '1:1'
      base.output_format = 'png'
      // `resolution` is what gets billed on FLUX.2 ($0.015/MP in + $0.015/MP
      // out), so pin it to 1 MP rather than inheriting a larger default.
      base.resolution = '1 MP'
      // BOTH flux-2 tiers take up to 8 reference images. The parameter is
      // `input_images` — the Replicate schema for black-forest-labs/flux-2-pro
      // and flux-2-max has no `image_inputs` field, so the previous spelling
      // silently dropped every reference and flux-2-max ran text-only.
      // Verified against GET /v1/models/black-forest-labs/flux-2-{pro,max}
      // (openapi_schema.components.schemas.Input) on 2026-07-26.
      if (refs.length > 0) base.input_images = refs.slice(0, 8)
      break
    }
    case 'xai/grok-imagine-image':
    case 'xai/grok-imagine-image-quality': {
      base.aspect_ratio = '1:1'
      break
    }
    case 'google/nano-banana':
    case 'google/nano-banana-2-lite': {
      // Nano Banana (Gemini 2.5 Flash Image) and Nano Banana 2 Lite (Gemini 3.1
      // Flash-Lite Image) share an identical input contract — uses image_input
      // ARRAY, not image_url. v1 accepts 2 refs, lite accepts up to 14.
      //
      // NOTE: `output_format: 'png'` is honored by v1 but SILENTLY IGNORED by
      // lite, which always returns JPEG (and Replicate's CDN still serves it
      // from a .png URL with an `image/png` content-type header). We keep
      // asking for png so v1 stays lossless; downstream upload paths sniff the
      // magic bytes rather than trusting the extension or the header.
      base.aspect_ratio = '1:1'
      base.output_format = 'png'
      if (refs.length > 0) base.image_input = refs
      break
    }
    case 'wan-video/wan-2.7-image-pro': {
      // Wan 2.7 — uses `size` enum ("1K"/"2K"/"4K"/"1024*1024" etc), and `images` array for editing.
      // Default 1K to keep generation under ~30s; bump to 2K/4K only when needed.
      base.size = '1024*1024'
      base.thinking_mode = true
      if (refs.length > 0) base.images = refs
      break
    }
    case 'recraft-ai/recraft-crisp-upscale': {
      // Crisp upscale — image-only, no prompt. Source image goes in `image`.
      delete base.prompt
      if (refs[0]) base.image = refs[0]
      break
    }
    case 'google/imagen-4-fast':
    case 'google/imagen-4-ultra': {
      // Imagen 4 on Replicate honors a dedicated `negative_prompt` parameter much
      // more strictly than embedding STRICTLY-FORBIDDEN blocks in the positive
      // prompt — Imagen tends to down-weight long negations buried in a single
      // prompt. Callers pass it via `extra.negative_prompt`; we surface it as a
      // first-class field here.
      base.aspect_ratio = '1:1'
      // Loosest available filter — Imagen's default over-blocks benign design
      // prompts (mascots, "roaring", athletic themes) with E005 "flagged as
      // sensitive". 'block_only_high' still blocks genuinely explicit content.
      base.safety_filter_level = 'block_only_high'
      break
    }
    case 'bytedance/seedream-4.5': {
      base.aspect_ratio = '1:1'
      base.max_images = 1
      break
    }
    case 'leonardoai/lucid-origin': {
      base.aspect_ratio = '1:1'
      base.num_images = 1
      break
    }
    case 'ideogram-ai/ideogram-v3-quality': {
      base.aspect_ratio = '1:1'
      break
    }
    case 'recraft-ai/recraft-v3':
    case 'recraft-ai/recraft-v4': {
      base.size = '1024x1024'
      break
    }
    case 'bytedance/seedream-5-lite': {
      if (refs[0]) base.image = refs[0]
      break
    }

    default: {
      if (refs.length > 0) base.image_url = refs[0]
      break
    }
  }

  return { ...base, ...(opts.extra ?? {}) }
}
