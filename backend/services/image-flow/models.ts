// Image-flow model registry.
// Ported from david-trinidad-com (Watchtower) at src/modules/image-flow/lib/models.ts
// with ITP additions: openai/gpt-image-2 (default for ITP product builder).

export type Provider = 'replicate' | 'fal'

export type ModelTier =
  | 'draft'
  | 'workhorse'
  | 'hero'
  | 'text-in-image'
  | 'vector'
  | 'edit'
  | 'mockup'
  | 'upscale'
  | 'bg'

export type Strength =
  | 'fast-draft'
  | 'photoreal-people'
  | 'photoreal-product'
  | 'stylized'
  | 'concept-art'
  | 'text-in-image'
  | 'logo-vector'
  | 'edit'
  | 'multi-image'
  | 'bg-remove'
  | 'bg-replace'

export interface NativeParam {
  key: string
  label: string
  kind: 'select' | 'number' | 'text' | 'boolean'
  options?: { value: string; label: string }[]
  default?: string | number | boolean
  min?: number
  max?: number
  description?: string
  placeholder?: string
  group?: 'basic' | 'advanced'
}

export interface ImageModel {
  id: string
  provider: Provider
  tier: ModelTier
  label: string
  costPerImageUsd: number
  approxSeconds: number
  strengths: Strength[]
  /** True if model accepts both text-only (generate) and image+text (edit) inputs through the same endpoint. */
  unifiedGenAndEdit?: boolean
  notes?: string
  promptCraft?: string
  nativeParams?: NativeParam[]
}

export const MODELS: ImageModel[] = [
  // --- DRAFT ---
  {
    id: 'prunaai/z-image-turbo',
    provider: 'replicate',
    tier: 'draft',
    label: 'Z-Image Turbo',
    costPerImageUsd: 0.005,
    approxSeconds: 1,
    strengths: ['fast-draft', 'text-in-image'],
    notes: 'Default draft. EN+CN bilingual text. Sub-second.',
    promptCraft:
      "Short comma-separated keywords, <25 words. Skip cinematic prose. For text, wrap it in double quotes: 'poster that says \"HELLO\"'. EN or CN both work.",
  },
  {
    id: 'black-forest-labs/flux-schnell',
    provider: 'replicate',
    tier: 'draft',
    label: 'Flux Schnell',
    costPerImageUsd: 0.003,
    approxSeconds: 1,
    strengths: ['fast-draft'],
    notes: 'Fallback draft.',
    promptCraft:
      'Terse, concrete, <20 words. Subject + 2–3 descriptors + style keyword. Schnell ignores over-long prompts — keep it punchy.',
  },

  // --- WORKHORSE ---
  {
    id: 'google/imagen-4-fast',
    provider: 'replicate',
    tier: 'workhorse',
    label: 'Imagen 4 Fast',
    costPerImageUsd: 0.02,
    approxSeconds: 3,
    strengths: ['photoreal-people', 'photoreal-product'],
    promptCraft:
      "Photography-first. Specify camera/lens (e.g. 'shot on 50mm', 'f/1.8'), lighting, and subject detail. Avoid illustrative prose.",
  },
  {
    id: 'black-forest-labs/flux-2-pro',
    provider: 'replicate',
    tier: 'workhorse',
    label: 'Flux 2 Pro',
    costPerImageUsd: 0.03,
    approxSeconds: 8,
    strengths: ['photoreal-people', 'text-in-image'],
    promptCraft:
      'Handles narrative prose. Describe the scene as a photograph or cinematic frame. For text, put the exact string in double quotes. 60–120 words.',
  },
  {
    id: 'black-forest-labs/flux-1.1-pro',
    provider: 'replicate',
    tier: 'workhorse',
    label: 'Flux 1.1 Pro',
    costPerImageUsd: 0.04,
    approxSeconds: 4,
    strengths: ['photoreal-people', 'stylized'],
    promptCraft:
      'Balanced — blend photographic specs with style descriptors. Lead with subject, then lighting, then style. 40–100 words.',
  },
  {
    id: 'recraft-ai/recraft-v4',
    provider: 'replicate',
    tier: 'workhorse',
    label: 'Recraft V4',
    costPerImageUsd: 0.04,
    approxSeconds: 10,
    strengths: ['stylized', 'text-in-image'],
    promptCraft:
      "Specify the illustration style explicitly: 'in flat vector style', 'isometric 3D'. Strong at typography — text in double quotes renders crisply.",
  },

  // --- HERO ---
  {
    id: 'black-forest-labs/flux-1.1-pro-ultra',
    provider: 'replicate',
    tier: 'hero',
    label: 'Flux 1.1 Pro Ultra',
    costPerImageUsd: 0.06,
    approxSeconds: 10,
    strengths: ['stylized', 'photoreal-product'],
    promptCraft:
      "Premium hero output — full cinematic prose (80–150 words). Specify composition, lighting, materials, mood.",
  },
  {
    id: 'google/imagen-4-ultra',
    provider: 'replicate',
    tier: 'hero',
    label: 'Imagen 4 Ultra',
    costPerImageUsd: 0.06,
    approxSeconds: 8,
    strengths: ['photoreal-people', 'photoreal-product'],
    promptCraft:
      "Portrait and product king. Specify subject, lens, lighting, background — in that order. Avoid illustrative language.",
  },
  {
    id: 'black-forest-labs/flux-2-max',
    provider: 'replicate',
    tier: 'hero',
    label: 'Flux 2 Max',
    costPerImageUsd: 0.07,
    approxSeconds: 12,
    strengths: ['photoreal-product', 'edit', 'multi-image'],
    notes: 'BFL flagship. Multi-reference (up to 8).',
    promptCraft:
      "Up to 8 reference images. Call refs by role ('reference 1 = the jacket'). Otherwise cinematic prose like Flux Ultra.",
  },
  {
    id: 'wan-video/wan-2.7-image-pro',
    provider: 'replicate',
    tier: 'hero',
    label: 'Wan 2.7 Image Pro',
    costPerImageUsd: 0.08,
    approxSeconds: 30,
    strengths: ['photoreal-product', 'stylized', 'edit', 'multi-image', 'text-in-image'],
    unifiedGenAndEdit: true,
    notes: 'Alibaba Wan 2.7 Pro — up to 4K, thinking mode, multi-image editing (up to 9 refs).',
    promptCraft:
      "Detailed prose works well. Specify subject, composition, lighting, and quality cues. For text in image, wrap in double quotes. Slow but high-fidelity — best for hero / product shots that need fine detail.",
  },
  {
    id: 'xai/grok-imagine-image',
    provider: 'replicate',
    tier: 'hero',
    label: 'Grok Imagine',
    costPerImageUsd: 0.02,
    approxSeconds: 4,
    strengths: ['stylized', 'text-in-image', 'concept-art'],
    notes: 'xAI Grok Imagine — top-6 ELO on Artificial Analysis Image Arena.',
    promptCraft:
      'Rewards bold, stylized, slightly weird prompts. Lead with mood/style, then subject. For text, wrap in double quotes. Cinematic prose works well.',
  },

  // --- TEXT-IN-IMAGE ---
  {
    id: 'ideogram-ai/ideogram-v3-quality',
    provider: 'replicate',
    tier: 'text-in-image',
    label: 'Ideogram v3 Quality',
    costPerImageUsd: 0.09,
    approxSeconds: 8,
    strengths: ['text-in-image'],
    promptCraft:
      "Text king. Put exact headline in double quotes at the top. Then describe the visual. Specify font vibe (serif, sans, script).",
  },

  // --- VECTOR ---
  {
    id: 'recraft-ai/recraft-v3',
    provider: 'replicate',
    tier: 'vector',
    label: 'Recraft V3 SVG',
    costPerImageUsd: 0.08,
    approxSeconds: 15,
    strengths: ['logo-vector'],
    promptCraft:
      "Flat-vector language. Under 40 words. Specify subject, style ('flat vector', 'line art'), color count, background color.",
  },

  // --- EDIT (default tier for ITP admin product builder) ---
  {
    id: 'openai/gpt-image-2',
    provider: 'replicate',
    tier: 'edit',
    label: 'GPT Image 2',
    costPerImageUsd: 0.04,
    approxSeconds: 12,
    strengths: ['edit', 'multi-image', 'photoreal-product', 'photoreal-people', 'text-in-image'],
    unifiedGenAndEdit: true,
    notes:
      'OpenAI GPT Image 2 (released Apr 21, 2026). Single endpoint serves both text-to-image and image edits. Accepts up to 10 input images for compositing — used for Mr. Imagine character + design fusion.',
    promptCraft:
      "Instruction-style edits. State both what changes AND what stays the same. For multi-image compositing, describe each input by role: 'Input 1 is the character, input 2 is the design — apply the design to the character\\'s shirt.' For pure generation (no input images), write 40–120 words of clear scene description.",
    nativeParams: [
      {
        key: 'aspect_ratio',
        label: 'Aspect ratio',
        kind: 'select',
        options: [
          { value: '1:1', label: '1:1 square' },
          { value: '3:2', label: '3:2 landscape' },
          { value: '2:3', label: '2:3 portrait' },
        ],
        default: '1:1',
        group: 'basic',
      },
      {
        key: 'quality',
        label: 'Quality',
        kind: 'select',
        options: [
          { value: 'low', label: 'Low (fastest)' },
          { value: 'medium', label: 'Medium' },
          { value: 'high', label: 'High' },
          { value: 'auto', label: 'Auto' },
        ],
        default: 'high',
        group: 'basic',
      },
      {
        key: 'output_format',
        label: 'Output format',
        kind: 'select',
        options: [
          { value: 'png', label: 'PNG' },
          { value: 'webp', label: 'WebP' },
          { value: 'jpeg', label: 'JPEG' },
        ],
        default: 'png',
        group: 'basic',
      },
      {
        key: 'background',
        label: 'Background',
        kind: 'select',
        options: [
          { value: 'auto', label: 'Auto' },
          { value: 'opaque', label: 'Opaque' },
        ],
        default: 'auto',
        group: 'advanced',
      },
      {
        key: 'moderation',
        label: 'Moderation',
        kind: 'select',
        options: [
          { value: 'auto', label: 'Auto (default)' },
          { value: 'low', label: 'Low (more permissive)' },
        ],
        default: 'auto',
        group: 'advanced',
      },
    ],
  },
  {
    id: 'fal-ai/flux-pro/kontext',
    provider: 'fal',
    tier: 'edit',
    label: 'Flux Kontext Pro',
    costPerImageUsd: 0.04,
    approxSeconds: 5,
    strengths: ['edit', 'stylized'],
    promptCraft:
      "Strong at style transfer and contextual edits. 'Turn this into a watercolor painting.' Short and directive (<30 words).",
  },
  {
    id: 'fal-ai/gemini-3-pro-image-preview/edit',
    provider: 'fal',
    tier: 'edit',
    label: 'Gemini 3 Pro Image',
    costPerImageUsd: 0.15,
    approxSeconds: 8,
    strengths: ['edit', 'photoreal-people', 'multi-image'],
    notes: 'Identity-lock, reasoning edits. Triggers cost gate.',
    promptCraft:
      "Reasoning edits — 'make him look 10 years older while preserving identity'. Brief like a retoucher.",
  },

  // --- MOCKUP (apparel-on-model rendering) ---
  {
    id: 'google/nano-banana',
    provider: 'replicate',
    tier: 'mockup',
    label: 'Nano Banana',
    costPerImageUsd: 0.039,
    approxSeconds: 8,
    strengths: ['edit', 'multi-image', 'photoreal-product'],
    notes: 'Gemini 2.5 Flash Image — best quality on garment mockups (flat lay, ghost mannequin, character fusion).',
    promptCraft:
      "Multi-image input. For mockups, supply [character?, design] image_input array; describe the garment, color, and where the print sits. Keep instructions concrete.",
  },

  // --- UPSCALE ---
  {
    id: 'recraft-ai/recraft-crisp-upscale',
    provider: 'replicate',
    tier: 'upscale',
    label: 'Recraft Crisp Upscale',
    costPerImageUsd: 0.006,
    approxSeconds: 6,
    strengths: ['photoreal-product', 'stylized'],
    notes: 'Top-rated upscaler for graphic design + illustration content per 2026 benchmarks. Cheapest of the field. Strong text preservation.',
    promptCraft: 'No prompt needed — pass the source image only.',
  },

  // --- BG ---
  {
    id: 'fal-ai/bria/background/remove',
    provider: 'fal',
    tier: 'bg',
    label: 'Bria BG Remove',
    costPerImageUsd: 0.018,
    approxSeconds: 1,
    strengths: ['bg-remove'],
    promptCraft: 'No prompt needed.',
  },
  {
    id: 'fal-ai/bria/background/replace',
    provider: 'fal',
    tier: 'bg',
    label: 'Bria BG Replace',
    costPerImageUsd: 0.04,
    approxSeconds: 3,
    strengths: ['bg-replace'],
    promptCraft:
      "Describe ONLY the new background, not the subject. 'A sunlit marble studio with soft shadows.'",
  },
]

export const COST_GATE_THRESHOLD_USD = 0.1

export const PURPOSE_ENUM = [
  'product',
  'product-edit',
  'mockup',
  'hero',
  'banner',
  'gallery',
  'thumbnail',
  'avatar',
  'logo',
  'icon',
  'background',
  'social-post',
  'email-header',
  'blog-cover',
  'concept',
  'reference',
] as const

export type Purpose = (typeof PURPOSE_ENUM)[number]

export function getModel(id: string): ImageModel | undefined {
  return MODELS.find((m) => m.id === id)
}

export function modelsByTier(tier: ModelTier): ImageModel[] {
  return MODELS.filter((m) => m.tier === tier)
}

export function requiresCostGate(model: ImageModel): boolean {
  return model.costPerImageUsd > COST_GATE_THRESHOLD_USD
}

/** ITP defaults — admin product builder uses gpt-image-2 for everything. */
export const DEFAULT_GENERATE_MODEL = 'openai/gpt-image-2'
export const DEFAULT_EDIT_MODEL = 'openai/gpt-image-2'
export const DEFAULT_MOCKUP_MODEL = 'google/nano-banana'
export const DEFAULT_BG_REMOVE_MODEL = 'fal-ai/bria/background/remove'
export const DEFAULT_UPSCALE_MODEL = 'recraft-ai/recraft-crisp-upscale'

/**
 * Models the admin product builder fans out to in parallel for design generation.
 * gpt-image-2 is intentionally NOT in this list — it's reserved for editing only
 * (slower + more expensive than the dedicated generation models).
 */
export const ADMIN_MULTI_MODEL_IDS = [
  'recraft-ai/recraft-v4',
  'xai/grok-imagine-image',
  'google/imagen-4-ultra',
  'wan-video/wan-2.7-image-pro',
]

/** User-selectable edit models for the refine step. */
export const ADMIN_EDIT_MODEL_OPTIONS = [
  {
    id: 'openai/gpt-image-2',
    label: 'GPT Image 2',
    description: 'Highest quality, slower (~25s), higher cost. Best at preserving identity and following complex instructions.',
    approxSeconds: 25,
    costPerImageUsd: 0.04,
  },
  {
    id: 'fal-ai/gemini-3-pro-image-preview/edit',
    label: 'Gemini 3 Pro Image',
    description: 'Reasoning-edit model. Faster (~8s) but pricier per call. Strong at identity-locked edits.',
    approxSeconds: 8,
    costPerImageUsd: 0.15,
  },
] as const
