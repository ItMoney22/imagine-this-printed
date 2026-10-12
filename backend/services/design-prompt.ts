// ---------------------------------------------------------------------------
// Which AI prompt drew a product's design, and which design concept it
// belongs to (task 47174caa, design-level click & conversion tracking).
//
// Every create path already leaves the prompt on products.metadata, just
// under different keys, so this reads them instead of touching each path:
//
//   prompt (what the image model was given), first hit wins:
//     image_prompt -> original_prompt -> prompt -> step_flow.idea -> design_concept
//     (the last two only when there is no library design_id: an adopted library
//     design carries its title as step_flow.idea)
//   concept (the idea the variants share), first hit wins:
//     brief_key (Mrs. Imagine brief) -> step_flow.idea -> design_concept
//     -> original_prompt's first line when a separate image_prompt exists
//     -> the prompt itself (a concept of one, until a sibling shares it)
//
// A product with none of those (design library, creator upload, toy) is a
// hand-made design: no prompt, its own concept, still on the dashboard.
//
// Pure and I/O-free so the unit tests pin every rule.
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto'
import { isBlankGarmentMeta } from '../shared/blank-pricing.js'

export interface DesignPromptInfo {
  /** Stable id of the prompt variant: same prompt + same model = same variant. */
  variantKey: string
  conceptKey: string
  conceptLabel: string
  /** null for a hand-made design. */
  promptText: string | null
  modelId: string | null
  source: 'mrs_imagine' | 'step_flow' | 'design_modal' | 'ai' | 'library' | 'creator' | 'handmade'
}

export interface ProductForPrompt {
  id: string
  name?: string | null
  metadata?: Record<string, any> | null
}

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null

/** Drops the "Product Category: shirts" line older create paths appended. */
export function stripPromptBoilerplate(text: string): string {
  return text
    .split(/\r?\n/)
    .filter(line => !/^\s*product category\s*:/i.test(line))
    .join('\n')
    .trim()
}

/** Case, whitespace and trailing punctuation never make a new variant. */
export function normalizePrompt(text: string): string {
  return stripPromptBoilerplate(text)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\s.!?,;:]+$/, '')
    .trim()
}

const hash = (s: string, len: number) => createHash('sha256').update(s).digest('hex').slice(0, len)

const firstLine = (text: string) => stripPromptBoilerplate(text).split(/\r?\n/)[0].trim()

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

const humanizeKey = (key: string) => {
  const words = key.replace(/[-_]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Blank garments are not designs; they never get a dashboard row. */
export function isTrackableDesign(product: ProductForPrompt): boolean {
  return !isBlankGarmentMeta(product.metadata)
}

export function deriveDesignPrompt(product: ProductForPrompt): DesignPromptInfo {
  const m = product.metadata || {}
  const stepIdea = str(m.step_flow?.idea)
  const designConcept = str(m.design_concept)
  const imagePrompt = str(m.image_prompt)
  const originalPrompt = str(m.original_prompt)

  // A library design adopted into the Step Flow carries its name as step_flow.idea;
  // that is a title, not a prompt, so it stays hand-made.
  const rawPrompt = imagePrompt || originalPrompt || str(m.prompt) || (str(m.design_id) ? null : stepIdea || designConcept)
  const promptText = rawPrompt ? stripPromptBoilerplate(rawPrompt) : null
  const modelId = str(m.model_id)

  if (!promptText) {
    // Hand-made: the library design number when there is one, else the product.
    const designId = str(m.design_id)
    const key = designId ? `design:${designId}` : `product:${product.id}`
    return {
      variantKey: `handmade:${designId ? `design-${designId}` : product.id}`,
      conceptKey: key,
      conceptLabel: str(product.name) || 'Untitled design',
      promptText: null,
      modelId: null,
      source: designId ? 'library' : (str(m.creator_id) || m.source === 'merch-studio') ? 'creator' : 'handmade',
    }
  }

  const variantKey = `v_${hash(`${normalizePrompt(promptText)}|${(modelId || '').toLowerCase()}`, 24)}`

  const briefKey = str(m.brief_key)
  const shortOriginal =
    imagePrompt && originalPrompt && normalizePrompt(originalPrompt) !== normalizePrompt(imagePrompt)
      ? firstLine(originalPrompt)
      : null
  const idea = stepIdea || designConcept || shortOriginal || promptText

  const conceptKey = briefKey ? `brief:${briefKey}` : `idea:${hash(normalizePrompt(idea), 16)}`
  const conceptLabel = briefKey ? humanizeKey(briefKey) : clip(firstLine(idea), 90)

  const source: DesignPromptInfo['source'] = briefKey || m.mrs_imagine
    ? 'mrs_imagine'
    : stepIdea
      ? 'step_flow'
      : m.source === 'create_design_modal'
        ? 'design_modal'
        : 'ai'

  return { variantKey, conceptKey, conceptLabel, promptText, modelId, source }
}

/**
 * The artwork a product sells right now: its newest design-source asset
 * (product_assets kind 'source', role 'design'), else its library design
 * number, else the product itself.
 */
export function artworkIdFor(
  product: ProductForPrompt,
  designAssets: Array<{ id: string; created_at?: string | null }>,
): string {
  const newest = [...designAssets].sort((a, b) =>
    String(b.created_at || '').localeCompare(String(a.created_at || '')),
  )[0]
  if (newest) return newest.id
  const designId = str(product.metadata?.design_id)
  return designId ? `library:${designId}` : `product:${product.id}`
}
