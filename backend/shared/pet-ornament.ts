// Create-your-own pet ornament — the template contract (task 81358f3a, 2026-11-01).
//
// The customer picks a pet, types its name and, if they like, uploads a photo
// of THEIR pet. The photo is redrawn as a flat cartoon portrait, cut into at
// most four solid colours, and each colour becomes a raised layer of a 3D
// printed ornament (the A1's AMS holds four):
//
//   slot 1  plate   the disc and hanging cap, 0 .. 2.6 mm
//   slot 2  fur     the main coat colour, raised to 3.4 mm
//   slot 3  fur     the second coat colour, raised to 3.4 mm
//   slot 4  ink     black outlines, eyes, rim and the NAME, raised to 4.2 mm
//
// No photo -> a stock flat portrait for the pet type (backend/assets/pet-ornament).
// What they type is what prints: the name rides the same sanitizer as the
// 3D name gifts (backend/shared/name-print.ts).
//
// NO MIGRATION: rides `products.metadata.pet_ornament` (jsonb).
//
// Browser-safe on purpose (no node: imports): the product page imports it.
import { sanitizeName } from './name-print.js'

/** Bumped only for a breaking shape change. An unknown version is refused. */
export const PET_ORNAMENT_VERSION = 1

export interface PetChoice {
  /** Stable id; also the stock portrait's file name. */
  id: string
  /** What the customer reads ("Cat"). */
  label: string
}

/** Every pet the house can draw a stock portrait for. A template may offer a subset. */
export const PETS: PetChoice[] = [
  { id: 'cat', label: 'Cat' },
  { id: 'dog', label: 'Dog' },
  { id: 'bunny', label: 'Bunny' },
]

export interface PetOrnamentTemplate {
  version: number
  pets: PetChoice[]
  /** A house font id for the name (backend/assets/fonts). */
  font: string
  field: { key: string; label: string; max: number }
  /** Whether the customer may upload a photo of their own pet. */
  photo: boolean
  /** Dollars added per line for personalizing. 0 = the price already includes it. */
  upcharge: number
}

/** A pet name longer than this gets letters too small to print cleanly at 40 mm. */
export const PET_NAME_MAX = 12

/**
 * The filaments the floor stocks for this product (Bambu PLA Basic). A
 * portrait's colours are snapped to the nearest of these, so the preview
 * shows the plastic that will actually print, not the model's paint.
 */
export interface Filament {
  id: string
  name: string
  hex: string
}

export const FILAMENTS: Filament[] = [
  { id: 'white', name: 'Jade White', hex: '#F4F4F0' },
  { id: 'black', name: 'Black', hex: '#1B1B1B' },
  { id: 'light-gray', name: 'Light Gray', hex: '#C8CACC' },
  { id: 'gray', name: 'Gray', hex: '#8E9089' },
  { id: 'beige', name: 'Beige', hex: '#EBD9BC' },
  { id: 'latte', name: 'Latte Brown', hex: '#C9A27E' },
  { id: 'brown', name: 'Brown', hex: '#8B5A3C' },
  { id: 'cocoa', name: 'Cocoa Brown', hex: '#5A3A28' },
  { id: 'orange', name: 'Orange', hex: '#F07A2A' },
  { id: 'gold', name: 'Sunflower Yellow', hex: '#F2B33D' },
  { id: 'pink', name: 'Pink', hex: '#F2A0B4' },
]

export const PLATE_FILAMENT = 'white'
export const INK_FILAMENT = 'black'

export function filamentById(id: string): Filament | undefined {
  return FILAMENTS.find((f) => f.id === id)
}

/** A portrait id: the first 24 hex of a sha256, minted by the server. */
export const PORTRAIT_ID_RE = /^[a-f0-9]{24}$/

const FONT_RE = /^[a-z0-9-]{1,40}$/

/** Reads products.metadata.pet_ornament. Anything malformed is null, never guessed at. */
export function parsePetOrnament(metadata: unknown): PetOrnamentTemplate | null {
  const raw = (metadata as any)?.pet_ornament
  if (!raw || typeof raw !== 'object') return null
  if (raw.version !== PET_ORNAMENT_VERSION) return null
  if (typeof raw.font !== 'string' || !FONT_RE.test(raw.font)) return null

  // Ids ("cat") or whole choices ({ id: "cat", label: "Cat" }): the seed script
  // writes the parsed shape, so the live row (dff53dc2) holds objects, and
  // reading only ids made it "not a pet ornament" everywhere (task 5d007181).
  const listed: unknown[] = Array.isArray(raw.pets) && raw.pets.length ? raw.pets : PETS.map((p) => p.id)
  const wanted = listed.map((p) => (p && typeof p === 'object' ? (p as { id?: unknown }).id : p))
  const pets = PETS.filter((p) => wanted.includes(p.id))
  if (pets.length === 0) return null

  const f = raw.field ?? {}
  const key = typeof f.key === 'string' && /^[a-z_]{1,20}$/.test(f.key) ? f.key : 'name'
  const label = typeof f.label === 'string' && f.label.trim() ? f.label.trim().slice(0, 40) : "Your pet's name"
  const max = Number.isInteger(f.max) && f.max > 0 ? Math.min(f.max, PET_NAME_MAX) : PET_NAME_MAX

  const upcharge = typeof raw.upcharge === 'number' && Number.isFinite(raw.upcharge) && raw.upcharge >= 0 ? raw.upcharge : 0
  return { version: PET_ORNAMENT_VERSION, pets, font: raw.font, field: { key, label, max }, photo: raw.photo !== false, upcharge }
}

export interface PetOrnamentValues {
  pet: string
  name: string
  /** '' = the stock portrait for the pet. */
  portrait: string
}

/** The checkout/preview view of the cart line's values: every field re-checked. */
export function sanitizePetValues(template: PetOrnamentTemplate, raw: unknown): PetOrnamentValues {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const pet = typeof r.pet === 'string' && template.pets.some((p) => p.id === r.pet) ? r.pet : template.pets[0].id
  const name = sanitizeName(r[template.field.key], template.field.max)
  const portrait = template.photo && typeof r.portrait === 'string' && PORTRAIT_ID_RE.test(r.portrait) ? r.portrait : ''
  return { pet, name, portrait }
}
