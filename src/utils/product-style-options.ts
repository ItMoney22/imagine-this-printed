// Style options for the AI product builder modals (1-Shot + Bulk).
//
// Keys MUST stay in sync with `STYLE_SUFFIXES` in
// backend/routes/admin/ai-products.ts — the backend uses the key to look up
// the actual prompt suffix that gets appended to the DTF system prompt.
// Sending an unknown key from the frontend silently drops the style hint
// (base DTF constraints still apply), so a typo here just degrades to the
// default look rather than breaking generation.
//
// Preview URLs reuse the existing pre-rendered Flux samples in GCS at
// style-previews/{key}.png (rendered once via
// backend/scripts/generate-style-previews.ts). Bumping STYLE_PREVIEW_VERSION
// cache-busts when those PNGs are regenerated.

const STYLE_PREVIEW_BASE = 'https://storage.googleapis.com/imagine-this-printed-main/style-previews'
const STYLE_PREVIEW_VERSION = 'flux1.1pro-ultra-2026-04-28'
const previewUrl = (key: string) => `${STYLE_PREVIEW_BASE}/${key}.png?v=${STYLE_PREVIEW_VERSION}`

export interface ProductStyleOption {
  id: string
  label: string
  emoji: string
  /** Optional preview image (used by 1-Shot picker; not all keys need one). */
  previewUrl?: string
  /** One-line description shown in tooltips and on hover. */
  hint: string
}

export const PRODUCT_STYLE_OPTIONS: ProductStyleOption[] = [
  { id: 'realistic',  label: 'Realistic',  emoji: '📸', previewUrl: previewUrl('realistic'),  hint: 'Photorealistic, high detail.' },
  { id: 'cartoon',    label: 'Cartoon',    emoji: '🎨', previewUrl: previewUrl('cartoon'),    hint: 'Vibrant, bold outlines.' },
  { id: 'minimalist', label: 'Minimalist', emoji: '✨', previewUrl: previewUrl('minimalist'), hint: 'Clean lines, simple shapes.' },
  { id: 'vintage',    label: 'Vintage',    emoji: '📻', previewUrl: previewUrl('vintage'),    hint: 'Aged paper, retro feel.' },
  { id: 'cyberpunk',  label: 'Cyberpunk',  emoji: '🌃', previewUrl: previewUrl('cyberpunk'),  hint: 'Neon glow, futuristic.' },
  { id: 'fantasy',    label: 'Fantasy',    emoji: '🐉', previewUrl: previewUrl('fantasy'),    hint: 'Ethereal, painterly detail.' },
  { id: 'tattoo',     label: 'Tattoo',     emoji: '💀', hint: 'Bold blackwork, traditional flash.' },
  { id: 'streetwear', label: 'Streetwear', emoji: '🧢', hint: 'Modern urban, graphic-tee feel.' },
]
