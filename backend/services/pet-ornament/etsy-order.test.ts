// An Etsy pet ornament sale -> checkout's print files (task 5d007181).
//
// The model call, the drawing and storage are swapped out (etsyPetDeps,
// blobStore); the reader, the decisions and, in the last block, the real
// geometry + print-spec path run for real.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import sharp from 'sharp'
import { parsePetOrnament, sanitizePetValues } from '../../shared/pet-ornament.js'
import { buildEtsyPetLine, etsyPetDeps, petLineMeta, MIN_PHOTO_SIDE } from './etsy-order.js'
import type { PetDecision } from './pet-detect.js'
import { blobStore, printCheckSpec, signedPetParts, storePetPrint } from './store.js'

const template = parsePetOrnament({
  pet_ornament: { version: 1, font: 'brush-script', pets: ['cat', 'dog', 'bunny'], field: { key: 'name', label: "Your pet's name", max: 12 }, photo: true },
})!
const PHOTO_URL = 'https://i.etsystatic.com/uploads/abc123/pet.jpg'
const PORTRAIT = 'a1b2c3d4e5f6a1b2c3d4e5f6'

const txn = (answers: Array<[string, string]>) => ({
  transaction_id: 9001,
  listing_id: 4607572810,
  variations: answers.map(([label, value]) => ({ property_id: 54, value_id: null, formatted_name: label, formatted_value: value })),
})
const order = (name = 'Biscuit', photo: string | null = PHOTO_URL) =>
  txn([["Your pet&#39;s name", name], ...(photo ? [['A photo of your pet', photo] as [string, string]] : [])])

const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: '#a06030' } }).png().toBuffer()
const decision = (over: Partial<PetDecision> = {}): PetDecision => ({
  pet: 'dog', source: 'vision', usable: true, uncertain: false, reason: 'photo shows a dog (97% sure)',
  vision: { animal: 'dog', closest: 'dog', visible: true, confidence: 0.97, modelId: 'test-vision' }, ...over,
})

const real = { ...etsyPetDeps }
let fetched: string[]
let drawn: Array<{ bytes: number; label: string }>
let storedValues: any[]
let photos: Record<string, Buffer>

beforeEach(async () => {
  fetched = []
  drawn = []
  storedValues = []
  photos = { [PHOTO_URL]: await png(800, 600) }
  etsyPetDeps.fetch = (async (url: any) => {
    fetched.push(String(url))
    const body = photos[String(url)]
    return body ? new Response(new Uint8Array(body), { status: 200 }) : new Response('', { status: 404 })
  }) as any
  etsyPetDeps.detectPet = async () => decision()
  etsyPetDeps.drawPortrait = (async (photo: Buffer, label: string) => {
    drawn.push({ bytes: photo.length, label })
    return { id: PORTRAIT, map: {} as any, drawn: true }
  }) as any
  etsyPetDeps.storePetPrint = (async (_t: any, values: any) => {
    storedValues.push(values)
    return { path: 'users/pet-ornaments/geo-v1/k/print-spec.json', built: true, spec: { parts: [] } as any }
  }) as any
})
afterEach(() => Object.assign(etsyPetDeps, real))

describe('buildEtsyPetLine', () => {
  it("turns the name + photo answers into checkout's line", async () => {
    const line = await buildEtsyPetLine(order(), template)
    expect(line.status).toBe('ready')
    expect(line.path).toBe('users/pet-ornaments/geo-v1/k/print-spec.json')
    expect(fetched).toEqual([PHOTO_URL]) // the buyer's photo, downloaded from the answer
    expect(drawn).toEqual([{ bytes: photos[PHOTO_URL].length, label: 'Dog' }]) // the detected pet names the drawing
    // Exactly what checkout re-checks a cart line into.
    expect(line.values).toEqual({ pet: 'dog', name: 'Biscuit', portrait: PORTRAIT })
    expect(storedValues).toEqual([sanitizePetValues(template, { pet: 'dog', name: 'Biscuit', portrait: PORTRAIT })])
    expect(line.etsy).toMatchObject({
      transactionId: 9001, listingId: 4607572810, nameAnswer: 'Biscuit', photoUrl: PHOTO_URL, photoCandidates: 1,
      photo: { width: 800, height: 600, contentType: 'image/png', authed: false },
      pet: { id: 'dog', source: 'vision', uncertain: false, animal: 'dog', confidence: 0.97, modelId: 'test-vision' },
      portraitId: PORTRAIT,
    })
    expect(line.flags).toBeUndefined()
  })

  it('unescapes the name and caps it at 12 letters, with a flag a person sees', async () => {
    const line = await buildEtsyPetLine(order('Sir Reginald Fluffington'), template)
    expect(line.values.name).toBe('Sir Reginald')
    expect(line.values.name.length).toBeLessThanOrEqual(12)
    expect(line.flags).toContainEqual({ field: 'name', reason: 'name cut to 12 letters from "Sir Reginald Fluffington"' })
    expect((await buildEtsyPetLine(order('D&#39;Artagnan'), template)).values.name).toBe("D'Artagnan")
  })

  it('holds the line, and draws nothing, without a name', async () => {
    const line = await buildEtsyPetLine(order(''), template)
    expect(line).toMatchObject({ status: 'failed', path: null })
    expect(line.error).toMatch(/No pet name/)
    expect(drawn).toEqual([])
  })

  it('holds the line when the photo is missing: never a stock pet the buyer did not ask for', async () => {
    const line = await buildEtsyPetLine(order('Biscuit', null), template)
    expect(line.status).toBe('failed')
    expect(line.error).toMatch(/photo is missing/)
    expect(drawn).toEqual([])
  })

  it('holds the line when the photo is too small to draw', async () => {
    photos[PHOTO_URL] = await png(200, MIN_PHOTO_SIDE - 1)
    const line = await buildEtsyPetLine(order(), template)
    expect(line.error).toMatch(/too small to draw \(200x255/)
    expect(drawn).toEqual([])
  })

  it('holds the line when no pet can be seen in the photo', async () => {
    etsyPetDeps.detectPet = async () => decision({ usable: false, uncertain: true, reason: 'no pet could be seen in the photo (saw: none)' })
    const line = await buildEtsyPetLine(order(), template)
    expect(line.error).toMatch(/no pet could be seen/)
    expect(line.etsy.pet?.reason).toMatch(/no pet could be seen/)
    expect(drawn).toEqual([])
  })

  it('holds the line on a download Etsy refuses, saying why', async () => {
    const line = await buildEtsyPetLine(order('Biscuit', 'https://i.etsystatic.com/uploads/gone.jpg'), template)
    expect(line.error).toMatch(/Etsy answered 404/)
  })

  it('never fetches a link a buyer typed to somewhere else', async () => {
    const line = await buildEtsyPetLine(order('Biscuit', 'https://evil.example/x.jpg'), template)
    expect(fetched).toEqual([])
    expect(line.error).toMatch(/not an Etsy address/)
  })

  it('draws the largest photo when the buyer sent more than one', async () => {
    const big = 'https://i.etsystatic.com/uploads/big.png'
    photos[big] = await png(1200, 1000)
    const line = await buildEtsyPetLine(txn([['Name', 'Biscuit'], ['Photos', `${PHOTO_URL}, ${big}`]]), template)
    expect(line.etsy).toMatchObject({ photoUrl: big, photoCandidates: 2, photo: { width: 1200, height: 1000 } })
    expect(drawn[0].bytes).toBe(photos[big].length)
  })

  it('flags a guessed pet type for a person, and still builds', async () => {
    etsyPetDeps.detectPet = async () => decision({ pet: 'cat', source: 'default', uncertain: true, reason: 'pet type not checked (rate limited); used the cat default', vision: null })
    const line = await buildEtsyPetLine(order(), template)
    expect(line.status).toBe('ready')
    expect(line.values.pet).toBe('cat')
    expect(line.flags).toContainEqual({ field: 'pet', reason: 'pet type not checked (rate limited); used the cat default' })
  })

  it('lets the team re-run with the pet type, a new photo, or the stock design', async () => {
    let looked = false
    etsyPetDeps.detectPet = async () => { looked = true; return decision() }
    const withPet = await buildEtsyPetLine(order(), template, { pet: 'bunny' })
    expect(withPet.values.pet).toBe('bunny')
    expect(withPet.etsy.pet).toMatchObject({ id: 'bunny', source: 'operator' })
    expect(looked).toBe(false)

    fetched = []
    const withPhoto = await buildEtsyPetLine(order('Biscuit', null), template, { photo: await png(640, 640) })
    expect(withPhoto.status).toBe('ready')
    expect(withPhoto.etsy.photoUrl).toBe('operator')
    expect(fetched).toEqual([])

    drawn = []
    const stock = await buildEtsyPetLine(order('Biscuit', null), template, { stock: true, pet: 'dog' })
    expect(stock.values).toEqual({ pet: 'dog', name: 'Biscuit', portrait: '' })
    expect(drawn).toEqual([])

    expect((await buildEtsyPetLine(order(), template, { pet: 'parrot' })).error).toMatch(/not one of this ornament's pets/)
  })

  it('never throws: a storage failure is written on the line', async () => {
    etsyPetDeps.storePetPrint = async () => { throw new Error('GCS down') }
    const line = await buildEtsyPetLine(order(), template)
    expect(line).toMatchObject({ status: 'failed', error: 'GCS down', path: null })
  })
})

describe('petLineMeta', () => {
  it("writes checkout's own order_items keys, plus what Etsy said", async () => {
    const line = await buildEtsyPetLine(order(), template)
    const meta = petLineMeta(line)
    // routes/stripe.ts replaceOrderItems writes these five for every personalized line.
    expect(meta).toMatchObject({
      personalization: { pet: 'dog', name: 'Biscuit', portrait: PORTRAIT },
      print_file_path: 'users/pet-ornaments/geo-v1/k/print-spec.json',
      print_file_error: null,
      print_file_status: 'ready',
      personalization_flags: null,
    })
    expect(meta.etsy_pet).toBe(line.etsy)
    expect(petLineMeta(undefined)).toEqual({})
  })
})

describe('the real pipeline: geometry, print-spec and the bridge parts', () => {
  const files = new Map<string, Buffer>()
  const realBlob = { ...blobStore }
  beforeEach(() => {
    files.clear()
    etsyPetDeps.storePetPrint = real.storePetPrint
    blobStore.exists = async (p) => files.has(p)
    blobStore.read = async (p) => { const b = files.get(p); if (!b) throw new Error('missing ' + p); return b }
    blobStore.write = async (buf, p) => { files.set(p, buf) }
    blobStore.sign = async (p) => `https://signed.example/${p}`
  })
  afterEach(() => Object.assign(blobStore, realBlob))

  it('an Etsy line builds the same files a site order with the same values does, and the bridge sends them', async () => {
    // The stock dog has two coat colours, so four parts (a one-coat pet has three: slots 1-3).
    const line = await buildEtsyPetLine(order('Ginger', null), template, { stock: true, pet: 'dog' })
    expect(line.status).toBe('ready')
    const site = await storePetPrint(template, sanitizePetValues(template, { pet: 'dog', name: 'Ginger', portrait: '' }))
    expect(site.path).toBe(line.path) // same key, same folder: one set of files
    expect(site.built).toBe(false) // already there from the Etsy line

    const stls = [...files.keys()].filter((p) => p.endsWith('.stl'))
    expect(stls.map((p) => p.split('/').pop()).sort()).toEqual(['fur1.stl', 'fur2.stl', 'ink.stl', 'plate.stl'])

    const parts = await signedPetParts(line.path!)
    expect(parts.map((p) => [p.key, p.slot])).toEqual([['plate', 1], ['fur1', 2], ['fur2', 3], ['ink', 4]])
    for (const p of parts) expect(p.stlUrl).toBe(`https://signed.example/${p.stl}`)

    const spec = printCheckSpec(line.stored!.spec.parts, line.values.name, (k) => `${k}.stl`)
    expect(spec.plates[0].objects[0].parts).toEqual([
      { stl: 'plate.stl', slot: 1 }, { stl: 'fur1.stl', slot: 2 }, { stl: 'fur2.stl', slot: 3 }, { stl: 'ink.stl', slot: 4 },
    ])
    expect(spec.plates[0].name).toBe('Pet ornament Ginger')
    expect(spec.process).toBe('0.16mm Optimal @BBL A1')
  })
})
