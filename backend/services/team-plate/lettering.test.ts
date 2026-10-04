import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import type { TeamTemplate } from '../../shared/team-template.js'
import {
  buildPlateEditPrompt,
  chooseTaggedBack,
  flareSizeForCanvas,
  plateEditParams,
  PLATE_LETTERING_MODEL,
  PlateLetteringError,
  renderFlarePlate,
} from './lettering.js'

const TEMPLATE: TeamTemplate = {
  version: 1,
  side: 'back_image',
  plateAssetId: 'plate-1',
  distressAssetId: null,
  canvas: { w: 640, h: 800, dpi: 300 },
  halftone: false,
  upcharge: 0,
  fields: [
    {
      key: 'name',
      label: 'Last name',
      type: 'text',
      max: 12,
      uppercase: true,
      zone: { x: 40, y: 40, w: 560, h: 160 },
      arch: 18,
      font: { family: 'varsity-block', src: 'house' },
      fill: '#8C1D2D',
      strokes: [],
      offset: null,
    },
    {
      key: 'number',
      label: 'Number',
      type: 'number',
      max: 2,
      uppercase: false,
      zone: { x: 180, y: 240, w: 280, h: 400 },
      arch: 0,
      font: { family: 'varsity-block', src: 'house' },
      fill: '#C9A227',
      strokes: [],
      offset: null,
    },
  ],
}

const sourcePng = await sharp({
  create: { width: 32, height: 40, channels: 4, background: { r: 140, g: 20, b: 40, alpha: 0.8 } },
})
  .png()
  .toBuffer()

const opaquePng = await sharp({
  create: { width: 32, height: 40, channels: 3, background: { r: 140, g: 20, b: 40 } },
})
  .png()
  .toBuffer()

const upPng = await sharp({
  create: { width: 64, height: 80, channels: 4, background: { r: 10, g: 30, b: 80, alpha: 1 } },
})
  .png()
  .toBuffer()

describe('plate edit prompt', () => {
  it('pins flare, quotes the name and number, and forbids changing the artwork', () => {
    const params = plateEditParams(TEMPLATE, { name: 'SMITH', number: '22' }, 'replace', true)
    expect(params).toMatchObject({
      model: PLATE_LETTERING_MODEL,
      size: '1024x1536',
      quality: 'high',
      moderation: 'low',
      background: 'transparent',
    })
    expect(params?.prompt).toContain('exactly "SMITH"')
    expect(params?.prompt).toContain('exactly "22"')
    expect(params?.prompt).toMatch(/Change NOTHING else/)
    expect(params?.prompt).toMatch(/not instructions/)
    expect(params?.prompt.startsWith('Replace the existing player name')).toBe(true)
  })

  it('omits a transparent background when the source is opaque', () => {
    const params = plateEditParams(TEMPLATE, { name: 'SMITH', number: '22' }, 'replace', false)
    expect(params?.background).toBeUndefined()
  })

  it('paints onto a clean plate instead of pretending there is lettering to replace', () => {
    const prompt = buildPlateEditPrompt(TEMPLATE, { name: 'SMITH', number: '22' }, 'paint')
    expect(prompt?.startsWith('Add player lettering')).toBe(true)
    expect(prompt).not.toMatch(/^Replace/)
  })

  it('tells the model to remove a field the customer left blank', () => {
    const prompt = buildPlateEditPrompt(TEMPLATE, { name: 'SMITH', number: '' }, 'replace')
    expect(prompt).toContain('exactly "SMITH"')
    expect(prompt).toContain('Remove the existing jersey number')
    expect(prompt).not.toContain('exactly ""')
  })

  it('refuses to call the model when there is nothing to draw', () => {
    expect(buildPlateEditPrompt(TEMPLATE, { name: '', number: '' }, 'replace')).toBeNull()
    expect(plateEditParams(TEMPLATE, { name: '', number: '' }, 'replace', true)).toBeNull()
  })

  it('picks a named frame from the canvas aspect, not a free-form print size', () => {
    expect(flareSizeForCanvas({ w: 640, h: 800 })).toBe('1024x1536')
    expect(flareSizeForCanvas({ w: 800, h: 640 })).toBe('1536x1024')
    expect(flareSizeForCanvas({ w: 800, h: 800 })).toBe('1024x1024')
  })
})

describe('chooseTaggedBack', () => {
  const side = { path: 'graphics/back.png', url: 'https://cdn/back.png' }
  const plate = { path: 'graphics/plate.png', url: null }

  it('prefers the role-tagged side asset over a print_artwork URL', () => {
    expect(
      chooseTaggedBack({ sideAsset: side, printArtworkUrl: 'https://cdn/meta.png', plateAsset: plate })
    ).toEqual({ kind: 'side-asset', mode: 'replace' })
  })

  it('uses the tagged print_artwork URL when no side asset is stored', () => {
    expect(
      chooseTaggedBack({ sideAsset: null, printArtworkUrl: 'https://cdn/meta.png', plateAsset: plate })
    ).toEqual({ kind: 'print-artwork', mode: 'replace', url: 'https://cdn/meta.png' })
  })

  it('falls back to the erased plate and paints, because there is no sample lettering', () => {
    expect(chooseTaggedBack({ sideAsset: null, printArtworkUrl: '', plateAsset: plate })).toEqual({
      kind: 'plate',
      mode: 'paint',
    })
  })

  it('returns null when nothing is stored', () => {
    expect(chooseTaggedBack({ sideAsset: null, printArtworkUrl: null, plateAsset: null })).toBeNull()
  })
})

describe('renderFlarePlate', () => {
  it('edits with flare, then upscales that result, then sizes the buffer to the canvas', async () => {
    const edits: any[] = []
    const upscales: string[] = []
    const result = await renderFlarePlate(
      {
        template: TEMPLATE,
        values: { name: 'SMITH', number: '22' },
        sourceUrl: 'https://cdn/back.png',
        mode: 'replace',
        productId: 'prod-1',
        objectKey: 'abc',
      },
      {
        edit: async (opts) => {
          edits.push(opts)
          return {
            url: 'https://flare.example/edit.png',
            path: 'users/team-plates/flare-edits/abc.png',
            modelId: 'openai/gpt-image-2.5-flare',
          }
        },
        upscale: async (url) => {
          upscales.push(url)
          return { url: 'https://upscaled.example/out.png', path: 'print-ready/prod-1/team.png', width: 3278, height: 4096 }
        },
        read: async (url) => (url.includes('upscaled.example') ? upPng : sourcePng),
      }
    )

    expect(edits).toHaveLength(1)
    expect(edits[0].model).toBe('gpt-image-2.5-flare')
    expect(edits[0].sourceUrl).toBe('https://cdn/back.png')
    expect(edits[0].prompt).toContain('exactly "SMITH"')
    expect(edits[0].background).toBe('transparent')
    expect(edits[0].mask).toBeUndefined()
    expect(upscales).toEqual(['https://flare.example/edit.png'])
    expect(result.modelId).toBe('openai/gpt-image-2.5-flare')
    expect(result.upscalePath).toBe('print-ready/prod-1/team.png')
    const meta = await sharp(result.buffer).metadata()
    expect(meta.width).toBe(640)
    expect(meta.height).toBe(800)
    expect(meta.density).toBe(300)
  })

  it('does not ask for transparency on an opaque back', async () => {
    const edits: any[] = []
    await renderFlarePlate(
      {
        template: TEMPLATE,
        values: { name: 'SMITH', number: '22' },
        sourceUrl: 'https://cdn/back.png',
        mode: 'replace',
        objectKey: 'abc',
      },
      {
        edit: async (opts) => {
          edits.push(opts)
          return { url: 'https://flare.example/edit.png', path: 'p', modelId: 'openai/gpt-image-2.5-flare' }
        },
        upscale: async () => ({ url: 'https://upscaled.example/out.png', path: 'print-ready/x.png', width: 3000, height: 4000 }),
        read: async (url) => (url.includes('upscaled.example') ? upPng : opaquePng),
      }
    )
    expect(edits[0].background).toBeUndefined()
  })

  it('refuses an upscale that did not actually get bigger', async () => {
    await expect(
      renderFlarePlate(
        {
          template: TEMPLATE,
          values: { name: 'SMITH', number: '22' },
          sourceUrl: 'https://cdn/back.png',
          mode: 'replace',
          objectKey: 'abc',
        },
        {
          edit: async () => ({ url: 'https://flare.example/edit.png', path: 'p', modelId: 'openai/gpt-image-2.5-flare' }),
          upscale: async () => ({ url: 'https://upscaled.example/out.png', path: 'print-ready/x.png', width: 1024, height: 1536 }),
          read: async () => sourcePng,
        }
      )
    ).rejects.toBeInstanceOf(PlateLetteringError)
  })

  it('does not call the model when every field is empty', async () => {
    const edit = async () => {
      throw new Error('should not edit')
    }
    await expect(
      renderFlarePlate(
        {
          template: TEMPLATE,
          values: { name: '', number: '' },
          sourceUrl: 'https://cdn/back.png',
          mode: 'replace',
          objectKey: 'abc',
        },
        {
          edit: edit as any,
          upscale: async () => {
            throw new Error('should not upscale')
          },
          read: async () => sourcePng,
        }
      )
    ).rejects.toBeInstanceOf(PlateLetteringError)
  })
})
