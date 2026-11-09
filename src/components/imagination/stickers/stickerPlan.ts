// Sticker Pack: what the customer picks, and how a pack is dealt out (one Flare call per sticker).
// The ids match backend/shared/sticker-styles.ts STICKER_STYLES; the backend refuses any other.

export const STICKER_TYPES = [
  { id: 'cartoon', label: 'Cartoon' },
  { id: 'kawaii', label: 'Kawaii chibi' },
  { id: 'emoji', label: 'Emoji faces' },
  { id: 'retro', label: 'Retro badge' },
  { id: 'holo', label: 'Holo foil' },
  { id: 'patch', label: 'Vintage patch' },
  { id: 'bubble', label: 'Speech bubble' },
  { id: 'photo', label: 'Photo cut-out' },
] as const
export type StickerTypeId = (typeof STICKER_TYPES)[number]['id']

export const PACK_SIZES = [4, 6, 8, 12] as const
export const DEFAULT_TYPES: StickerTypeId[] = ['cartoon', 'kawaii', 'emoji']
/** Flare's high tier, used until /flare/pricing answers. */
export const DEFAULT_STICKER_ITC = 40
/** Calls in flight at once: fast, and well inside the AI rate limit (60 per 10 minutes). */
export const PACK_CONCURRENCY = 3

export const stickerLabel = (id: string) => STICKER_TYPES.find((t) => t.id === id)?.label ?? id
export const stickerExample = (id: string) => `/station/stickers/${id}.webp`

/**
 * Deal `count` stickers across the chosen types in turn, so every type shows up before any repeats.
 * `variant` counts the copies of a type, which the backend turns into "a different pose from the first one".
 */
export function planPack(count: number, types: readonly string[]): Array<{ style: string; variant: number }> {
  if (types.length === 0 || count < 1) return []
  return Array.from({ length: count }, (_, i) => ({ style: types[i % types.length], variant: Math.floor(i / types.length) }))
}

/** The pack's file name for one sticker: sticker-03-kawaii-chibi.png */
export function stickerFileName(index: number, style: string): string {
  const slug = stickerLabel(style).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `sticker-${String(index + 1).padStart(2, '0')}-${slug}.png`
}
