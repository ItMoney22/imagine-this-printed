import { describe, it, expect } from 'vitest'
import {
  MINI_ME_AI_DISCLOSURE,
  MINI_ME_COLOUR_PROPERTY_ID,
  MINI_ME_MAX_UPLOAD_FILES,
  MINI_ME_PHOTO_GUIDANCE,
  MINI_ME_SIZE_PROPERTY_ID,
  MINI_ME_TAXONOMY_ID,
  inventoryProblems,
  miniMeCombos,
  miniMeCopyProblems,
  miniMeDraftListingForm,
  miniMeGoLiveBlockers,
  miniMeInventory,
  miniMeListingCopy,
  miniMePersonalization,
  personalizationProblems
} from './etsy-mini-me-listing.js'
import { MINI_ME_PRICE_CENTS } from '../shared/mini-me.js'

describe('Mini-Me Etsy copy', () => {
  const copy = miniMeListingCopy()

  it('meets every rule David set and every Etsy limit', () => {
    expect(miniMeCopyProblems(copy)).toEqual([])
  })

  it('carries the AI disclosure word for word', () => {
    expect(MINI_ME_AI_DISCLOSURE).toBe(
      'Your 3D model is generated with AI from your photo, then checked, sized and 3D-printed in PLA in our Rockmart, GA shop. The 4-colour option uses up to 4 solid filament colours.'
    )
    expect(copy.description).toContain(MINI_ME_AI_DISCLOSURE)
  })

  it('never says full colour anywhere', () => {
    const all = [copy.title, copy.description, ...copy.tags].join(' ')
    expect(all).not.toMatch(/full[\s-]*colou?r/i)
    expect(all).toContain('4-colour')
  })

  it('states the photo guidance, the preview approval, the consent refusal and original work', () => {
    expect(copy.description).toContain('1-3 clear photos, full body, face visible')
    expect(copy.description).toMatch(/3D preview by Etsy message/)
    expect(copy.description).toMatch(/only print after you approve your preview/i)
    expect(copy.description).toMatch(/refuse celebrity photos and photos without consent/i)
    expect(copy.description).toMatch(/never print other people's 3D files or bought models/i)
    expect(copy.description).toMatch(/DESIGNED BY A SELLER/)
  })

  it('catches the mistakes it exists to catch', () => {
    const bad = {
      ...copy,
      title: 'Mini-Me: full colour + paint: kit + more',
      description: copy.description.replace(MINI_ME_AI_DISCLOSURE, 'Made with AI.').replace(/celebrit/gi, 'famous'),
      tags: [...copy.tags, 'one tag too many here', 'x(y)']
    }
    const problems = miniMeCopyProblems(bad).join(' | ')
    expect(problems).toMatch(/full colour/)
    expect(problems).toMatch(/AI disclosure/)
    expect(problems).toMatch(/celebrity/)
    expect(problems).toMatch(/":" more than once/)
    expect(problems).toMatch(/"\+" more than once/)
    expect(problems).toMatch(/15 tags/)
    expect(problems).toMatch(/over 20 chars/)
    expect(problems).toMatch(/character Etsy refuses/)
  })
})

describe('Mini-Me personalization', () => {
  const { personalization_questions: qs } = miniMePersonalization()

  it('has exactly one photo-upload question taking up to 10 files, required', () => {
    const uploads = qs.filter(q => q.question_type.endsWith('upload'))
    expect(uploads).toHaveLength(1)
    expect(uploads[0]).toMatchObject({ question_type: 'unlabeled_upload', required: true, max_allowed_files: 10 })
    expect(MINI_ME_MAX_UPLOAD_FILES).toBe(10)
    expect(uploads[0].instructions).toContain(MINI_ME_PHOTO_GUIDANCE)
  })

  it('asks for the name on the base as an optional text answer', () => {
    const name = qs.find(q => q.question_type === 'text_input')
    expect(name).toMatchObject({ required: false })
    expect(name!.question_text).toMatch(/name on the base/i)
  })

  it('fits inside Etsy limits', () => {
    expect(personalizationProblems(qs)).toEqual([])
    expect(qs.length).toBeLessThanOrEqual(5)
  })

  it('refuses a second upload question and over-long text', () => {
    const two = [...qs, { ...qs[0], question_text: 'More photos' }]
    expect(personalizationProblems(two).join(' ')).toMatch(/2 upload questions/)
    const long = [{ ...qs[0], question_text: 'x'.repeat(46), instructions: 'y'.repeat(121), max_allowed_files: 11 }]
    const p = personalizationProblems(long).join(' ')
    expect(p).toMatch(/1-45 chars/)
    expect(p).toMatch(/over 120 chars/)
    expect(p).toMatch(/1-10/)
  })
})

describe('Mini-Me variations', () => {
  it('sells 8 combos: 10cm / 15cm, each with or without NFC, in White + paint kit or 4-colour', () => {
    const combos = miniMeCombos()
    expect(combos).toHaveLength(8)
    expect(new Set(combos.map(c => c.sizeLabel))).toEqual(new Set(['10cm', '10cm + NFC video', '15cm', '15cm + NFC video']))
    expect(new Set(combos.map(c => c.colourLabel))).toEqual(new Set(['White + paint kit', '4-colour']))
    expect(new Set(combos.map(c => c.sku)).size).toBe(8)
  })

  it('prices every combo from the one Mini-Me table', () => {
    const p = MINI_ME_PRICE_CENTS
    const by = (sku: string) => miniMeCombos().find(c => c.sku === sku)!.priceCents
    expect(by('MINIME-10-W')).toBe(p.white.small)
    expect(by('MINIME-15-C4')).toBe(p.white.medium + p.color4Upcharge.medium)
    expect(by('MINIME-10-W-NFC')).toBe(p.white.small + p.nfcVideo)
    expect(by('MINIME-15-C4-NFC')).toBe(p.white.medium + p.color4Upcharge.medium + p.nfcVideo)
  })

  it('builds the inventory write Etsy accepts: both axes priced, no parentheses, labels within 20 chars', () => {
    const inv = miniMeInventory(1503326006995)
    expect(inv.products).toHaveLength(8)
    expect(inv.price_on_property).toEqual([MINI_ME_SIZE_PROPERTY_ID, MINI_ME_COLOUR_PROPERTY_ID])
    expect(inv.products[0].offerings[0].readiness_state_id).toBe(1503326006995)
    expect(inventoryProblems(inv)).toEqual([])
  })

  it('lists the draft at the cheapest combo in the figurines category', () => {
    const form = miniMeDraftListingForm({ readinessStateId: 1, shippingProfileId: 2, returnPolicyId: 3 })
    expect(form.price).toBe(Math.min(...miniMeCombos().map(c => c.priceCents)) / 100)
    expect(form.taxonomy_id).toBe(MINI_ME_TAXONOMY_ID)
    expect(form).toMatchObject({ who_made: 'i_did', when_made: 'made_to_order', type: 'physical', is_supply: false })
    expect(form.tags.split(',')).toHaveLength(13)
  })
})

describe('Mini-Me go-live gate', () => {
  it('holds while there are no real sample photos or approved prices', () => {
    const b = miniMeGoLiveBlockers({ photoFiles: [], pricesApproved: false }).join(' | ')
    expect(b).toMatch(/prices are not approved/)
    expect(b).toMatch(/first real sample/)
  })

  it('refuses renders and mockups in place of photos', () => {
    const b = miniMeGoLiveBlockers({ photoFiles: ['sample-render.png', 'mockup-front.jpg', 'notes.pdf'], pricesApproved: true })
    expect(b.join(' ')).toMatch(/render/)
    expect(b.join(' ')).toMatch(/notes\.pdf is not a jpg or png/)
  })

  it('goes with real photos and approved prices', () => {
    expect(miniMeGoLiveBlockers({ photoFiles: ['statue-front.jpg', 'statue-side.png'], pricesApproved: true })).toEqual([])
  })
})
