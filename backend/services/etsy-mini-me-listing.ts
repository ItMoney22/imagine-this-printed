// ---------------------------------------------------------------------------
// The Etsy listing for Mini-Me (David 2026-10-07, task d76d6501): a statue of
// the buyer (or their pet) made from photos they upload ON ETSY.
//
// Pure: no I/O, no env. The runner (backend/scripts/etsy-mini-me-listing.ts)
// sends these payloads; etsy-mini-me-listing.test.ts holds the rules.
//
// What Etsy gives us (checked live 2026-10-07 against the Open API v3 spec at
// https://www.etsy.com/openapi/generated/oas/3.0.0.json and shop 67055923):
//   - Personalization is up to 5 questions, at most ONE upload question, written
//     with POST /shops/{shop}/listings/{id}/personalization
//     ?supports_multiple_personalization_questions=true (a full replace).
//     question_text <= 45 chars, instructions <= 120, max_allowed_files 1-10.
//     The buyer-side file limits (100 MB, jpg/png/svg/heic/pdf) are Etsy's own;
//     the API has no field for them.
//   - Two variation properties per listing. A third is a developer preview only
//     (max_variations_supported=3, from 2026-08-17, enrolled test accounts).
//   - Personalization questions cannot carry a price except an optional
//     text_input's add_on_price, which no code of ours has ever exercised.
//
// So the NFC video base rides the SIZE axis ("10cm + NFC video") instead of a
// third axis or a typed add-on: the buyer sees its price in the dropdown before
// checkout, and the inventory write is the same one the shop already runs live.
// Size x Colour = 8 priced combos, every price from the ONE Mini-Me table
// (backend/shared/mini-me.ts) — this file never states a number of its own.
// ---------------------------------------------------------------------------

import {
  MINI_ME_NFC_ADDON_ID,
  MINI_ME_PRICES_APPROVED,
  miniMeUnitCents,
  type MiniMeColorMode,
  type MiniMeSize
} from '../shared/mini-me.js'
import { MAX_TAGS, MAX_TAG_LEN, MAX_TITLE_LEN } from './etsy-listing-fields.js'

/** Art & Collectibles > Sculpture > Figurines (seller taxonomy, read live 2026-10-07). */
export const MINI_ME_TAXONOMY_ID = 130

/**
 * Taxonomy 130's generic variation slots ("Custom1"/"Custom2", no Etsy values).
 * The seller names them; Etsy shows our names to the buyer.
 */
export const MINI_ME_SIZE_PROPERTY_ID = 513
export const MINI_ME_COLOUR_PROPERTY_ID = 514

/** The Etsy title the runner's duplicate guard looks for before creating. */
export const MINI_ME_TITLE_MARK = 'Custom Mini-Me Figurine'

/**
 * Made to order, 5-10 days. Guess, not measured: no figurine has finished on
 * our A1s yet (first sample is task e0c81e3c). Covers the buyer approving the
 * 3D preview plus a ~4.5 h print; re-set it from the sample's real hours.
 */
export const MINI_ME_PROCESSING_DAYS = { min: 5, max: 10 } as const

/** Required wording (David 2026-10-07). Must appear verbatim in the description. */
export const MINI_ME_AI_DISCLOSURE =
  'Your 3D model is generated with AI from your photo, then checked, sized and 3D-printed in PLA in our Rockmart, GA shop. The 4-colour option uses up to 4 solid filament colours.'

/** David's photo guidance, verbatim. */
export const MINI_ME_PHOTO_GUIDANCE = '1-3 clear photos, full body, face visible'

/** Etsy allows 1-10 files on the upload question; we take the full 10. */
export const MINI_ME_MAX_UPLOAD_FILES = 10

/**
 * Longest name we promise to fit on a base. Guess: a 10 cm base is ~5 cm across
 * and stays legible at about 16 characters; confirm on the first sample.
 */
export const MINI_ME_NAME_MAX_CHARS = 16

const SIZE_CM: Record<MiniMeSize, number> = { small: 10, medium: 15 }
const COLOUR_LABEL: Record<MiniMeColorMode, string> = { white: 'White + paint kit', color4: '4-colour' }

export interface MiniMeCombo {
  size: MiniMeSize
  nfc: boolean
  colorMode: MiniMeColorMode
  sizeLabel: string
  colourLabel: string
  sku: string
  priceCents: number
}

/** Every Size x Colour combo the listing sells, priced from the Mini-Me table. */
export function miniMeCombos(): MiniMeCombo[] {
  const out: MiniMeCombo[] = []
  for (const size of ['small', 'medium'] as MiniMeSize[]) {
    for (const nfc of [false, true]) {
      for (const colorMode of ['white', 'color4'] as MiniMeColorMode[]) {
        const cm = SIZE_CM[size]
        out.push({
          size,
          nfc,
          colorMode,
          sizeLabel: nfc ? `${cm}cm + NFC video` : `${cm}cm`,
          colourLabel: COLOUR_LABEL[colorMode],
          sku: `MINIME-${cm}-${colorMode === 'white' ? 'W' : 'C4'}${nfc ? '-NFC' : ''}`,
          priceCents: miniMeUnitCents(size, colorMode, nfc ? [MINI_ME_NFC_ADDON_ID] : [])
        })
      }
    }
  }
  return out
}

export interface MiniMeListingCopy {
  title: string
  description: string
  tags: string[]
  materials: string[]
}

export function miniMeListingCopy(): MiniMeListingCopy {
  const description = [
    'Your own Mini-Me: a little statue of you, someone you love, or your pet, made from your photos and 3D-printed in our Rockmart, GA shop.',
    '',
    'DESIGNED BY A SELLER',
    `We design every Mini-Me ourselves, using AI, from the photos you upload. ${MINI_ME_AI_DISCLOSURE}`,
    '',
    'HOW IT WORKS',
    `1. Pick your size and colour, then upload ${MINI_ME_PHOTO_GUIDANCE}.`,
    '2. We make your 3D model and send you a 3D preview by Etsy message.',
    '3. You approve it or tell us what to change. We only print after you approve your preview.',
    '4. We print it, finish it and ship it to you.',
    '',
    'SIZES',
    '- 10cm: about 4 inches tall',
    '- 15cm: about 6 inches tall',
    '',
    'COLOUR',
    '- White + paint kit: printed in white PLA, with a paint kit so you can paint it yourself.',
    '- 4-colour: printed in up to 4 solid filament colours. It is not painted, so fine details take the nearest of the 4 colours.',
    '',
    'NFC VIDEO BASE (optional)',
    'Pick a size with "+ NFC video" and we hide a small chip in the base. Tap a phone on the base to play a video you choose. After you order, we message you on Etsy to collect the video.',
    '',
    'NAME ON THE BASE (optional)',
    `Type a name of up to ${MINI_ME_NAME_MAX_CHARS} characters in the personalization box and we add it to the base. Leave it blank for a plain base.`,
    '',
    'PHOTO RULES',
    `- ${MINI_ME_PHOTO_GUIDANCE}, in good light, with no heavy filters.`,
    '- People and pets are both welcome.',
    '- Only send photos you own or have permission to use, of people who agreed to be made into a statue.',
    '- We refuse celebrity photos and photos without consent, and cancel and refund those orders.',
    '',
    'ORIGINAL WORK',
    'Every Mini-Me is sculpted from your own photos. We never print other people\'s 3D files or bought models.',
    '',
    'MADE FOR YOU',
    'Each statue is made from your photos, so we can\'t take returns for a change of mind. If it arrives damaged or not as you approved it, message us a photo and we will replace it.'
  ].join('\n')

  return {
    title: `${MINI_ME_TITLE_MARK} From Your Photo, 3D Printed Person or Pet Statue, Personalized Gift, Paint Kit or 4-Colour`,
    description,
    tags: [
      'custom figurine',
      'mini me statue',
      'custom pet statue',
      'pet figurine',
      'photo to figurine',
      '3d printed statue',
      'personalized gift',
      'custom portrait',
      'paint your own',
      'pet memorial gift',
      'dog figurine',
      'cat figurine',
      'custom statue'
    ],
    materials: ['PLA']
  }
}

export interface PersonalizationQuestion {
  question_text: string
  question_type: 'text_input' | 'dropdown' | 'unlabeled_upload' | 'labeled_upload'
  required: boolean
  instructions?: string | null
  max_allowed_files?: number
  max_allowed_characters?: number
}

/** The body for POST .../personalization?supports_multiple_personalization_questions=true */
export function miniMePersonalization(): { personalization_questions: PersonalizationQuestion[] } {
  return {
    personalization_questions: [
      {
        question_text: 'Photos for your Mini-Me',
        question_type: 'unlabeled_upload',
        required: true,
        instructions: `${MINI_ME_PHOTO_GUIDANCE}. Only photos you own or have permission to use. No celebrities.`,
        max_allowed_files: MINI_ME_MAX_UPLOAD_FILES
      },
      {
        question_text: 'Name on the base (optional)',
        question_type: 'text_input',
        required: false,
        instructions: 'Leave blank for a plain base.',
        max_allowed_characters: MINI_ME_NAME_MAX_CHARS
      }
    ]
  }
}

/** The body for PUT /listings/{id}/inventory: 8 products, price + SKU on both axes. */
export function miniMeInventory(readinessStateId: number, quantity = 25) {
  return {
    products: miniMeCombos().map(c => ({
      sku: c.sku,
      property_values: [
        { property_id: MINI_ME_SIZE_PROPERTY_ID, property_name: 'Size', value_ids: [], values: [c.sizeLabel] },
        { property_id: MINI_ME_COLOUR_PROPERTY_ID, property_name: 'Colour', value_ids: [], values: [c.colourLabel] }
      ],
      offerings: [{ price: c.priceCents / 100, quantity, is_enabled: true, readiness_state_id: readinessStateId }]
    })),
    price_on_property: [MINI_ME_SIZE_PROPERTY_ID, MINI_ME_COLOUR_PROPERTY_ID],
    quantity_on_property: [],
    sku_on_property: [MINI_ME_SIZE_PROPERTY_ID, MINI_ME_COLOUR_PROPERTY_ID]
  }
}

/** The createDraftListing form. The listing price is the cheapest combo; inventory sets the rest. */
export function miniMeDraftListingForm(opts: { readinessStateId: number; shippingProfileId: number; returnPolicyId?: number }) {
  const copy = miniMeListingCopy()
  return {
    quantity: 25,
    title: copy.title,
    description: copy.description,
    price: Math.min(...miniMeCombos().map(c => c.priceCents)) / 100,
    who_made: 'i_did',
    when_made: 'made_to_order',
    is_supply: false,
    taxonomy_id: MINI_ME_TAXONOMY_ID,
    type: 'physical',
    should_auto_renew: true,
    shipping_profile_id: opts.shippingProfileId,
    return_policy_id: opts.returnPolicyId,
    readiness_state_id: opts.readinessStateId,
    tags: copy.tags.join(','),
    materials: copy.materials.join(',')
  }
}

const FULL_COLOUR = /full[\s-]*colou?r/i

/** Every David rule and Etsy limit the copy must meet. Empty = clean. */
export function miniMeCopyProblems(copy: MiniMeListingCopy): string[] {
  const problems: string[] = []
  const all = [copy.title, copy.description, ...copy.tags].join('\n')
  if (FULL_COLOUR.test(all)) problems.push('says "full colour" (David: always "4-colour")')
  if (!copy.description.includes(MINI_ME_AI_DISCLOSURE)) problems.push('AI disclosure line missing or not verbatim')
  if (!/designed by a seller/i.test(copy.description)) problems.push('no "Designed by a seller" framing')
  if (!copy.description.includes(MINI_ME_PHOTO_GUIDANCE)) problems.push('photo guidance missing')
  if (!/preview/i.test(copy.description) || !/approve/i.test(copy.description)) problems.push('no 3D-preview approval promise')
  if (!/celebrit/i.test(copy.description) || !/consent/i.test(copy.description)) problems.push('no celebrity/consent refusal')
  if (copy.title.length > MAX_TITLE_LEN) problems.push(`title is ${copy.title.length} chars (max ${MAX_TITLE_LEN})`)
  for (const ch of ['%', ':', '&', '+']) {
    if (copy.title.split(ch).length - 1 > 1) problems.push(`title uses "${ch}" more than once`)
  }
  if (copy.tags.length > MAX_TAGS) problems.push(`${copy.tags.length} tags (max ${MAX_TAGS})`)
  const seen = new Set<string>()
  for (const t of copy.tags) {
    if (t.length > MAX_TAG_LEN) problems.push(`tag "${t}" is over ${MAX_TAG_LEN} chars`)
    if (/[^A-Za-z0-9 -]/.test(t)) problems.push(`tag "${t}" has a character Etsy refuses`)
    if (seen.has(t.toLowerCase())) problems.push(`tag "${t}" is a duplicate`)
    seen.add(t.toLowerCase())
  }
  for (const m of copy.materials) {
    if (/[^\p{L}\p{Nd}\p{Zs}]/u.test(m)) problems.push(`material "${m}" has a character Etsy refuses`)
  }
  return problems
}

/** Etsy's personalization limits, checked before we send (a 400 would leave a half-built draft). */
export function personalizationProblems(questions: PersonalizationQuestion[]): string[] {
  const problems: string[] = []
  if (questions.length < 1 || questions.length > 5) problems.push(`${questions.length} questions (Etsy takes 1-5)`)
  const uploads = questions.filter(q => q.question_type === 'unlabeled_upload' || q.question_type === 'labeled_upload')
  if (uploads.length !== 1) problems.push(`${uploads.length} upload questions (the listing needs exactly one)`)
  for (const q of questions) {
    if (q.question_text.length < 1 || q.question_text.length > 45) problems.push(`question "${q.question_text}" is not 1-45 chars`)
    if ((q.instructions ?? '').length > 120) problems.push(`instructions for "${q.question_text}" are over 120 chars`)
    if (q.question_type.endsWith('upload')) {
      if (!q.max_allowed_files || q.max_allowed_files < 1 || q.max_allowed_files > 10) problems.push('upload max_allowed_files must be 1-10')
      if (q.max_allowed_characters !== undefined) problems.push('upload question cannot carry max_allowed_characters')
    }
    if (q.question_type === 'text_input' && !(q.max_allowed_characters && q.max_allowed_characters <= 1024)) {
      problems.push(`text question "${q.question_text}" needs max_allowed_characters 1-1024`)
    }
  }
  return problems
}

/** Inventory value rules: Etsy refuses parentheses, and we keep labels within the 20 chars every shop allows. */
export function inventoryProblems(inv: ReturnType<typeof miniMeInventory>): string[] {
  const problems: string[] = []
  for (const p of inv.products) {
    for (const pv of p.property_values) {
      for (const v of pv.values) {
        if (/[()]/.test(v)) problems.push(`value "${v}" has a parenthesis`)
        if (v.length > 20) problems.push(`value "${v}" is over 20 chars`)
      }
    }
    if (p.sku.length > 32) problems.push(`sku ${p.sku} is over 32 chars`)
    for (const o of p.offerings) {
      if (!(o.price >= 0.2)) problems.push(`${p.sku} price ${o.price} is under Etsy's $0.20 floor`)
    }
  }
  return problems
}

/**
 * Why the listing may not be created yet. Empty = go.
 * The photos are the first REAL sample's (task e0c81e3c) — never renders,
 * mockups or placeholders (David 2026-10-07).
 */
export function miniMeGoLiveBlockers(input: { photoFiles: string[]; pricesApproved?: boolean }): string[] {
  const blockers: string[] = []
  if (!(input.pricesApproved ?? MINI_ME_PRICES_APPROVED)) {
    blockers.push('Mini-Me prices are not approved (MINI_ME_PRICES_APPROVED is false in backend/shared/mini-me.ts)')
  }
  if (input.photoFiles.length === 0) {
    blockers.push('no photos of the first real sample statue (task e0c81e3c) were given')
  }
  if (input.photoFiles.length > 10) blockers.push(`${input.photoFiles.length} photos (Etsy takes 10)`)
  for (const f of input.photoFiles) {
    if (!/\.(jpe?g|png)$/i.test(f)) blockers.push(`${f} is not a jpg or png photo`)
    if (/render|mock|placeholder|preview/i.test(f)) blockers.push(`${f} looks like a render, not a photo of the printed sample`)
  }
  return blockers
}
