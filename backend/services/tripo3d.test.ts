import { describe, it, expect } from 'vitest'
import {
  TRIPO_API_BASE,
  TRIPO_MODEL_VERSION,
  SIZE_TIERS,
  buildImageToModelRequest,
  parseTripoTask,
  tierTextureMode
} from './tripo3d.js'

// Shapes from the V3 docs (developers.tripo3d.ai, 2026-10-07): POST /v3/generation/image-to-model
// { input, model, texture, pbr, texture_quality, orientation, face_limit, model_seed, ... }
// and GET /v3/tasks/{id} -> { code: 0, data: { status, progress, output: { model_url, rendered_image_url }, credits_consumed } }.

describe('Tripo V3 config', () => {
  it('points at the V3 API and one model version', () => {
    expect(TRIPO_API_BASE).toBe('https://openapi.tripo3d.ai/v3')
    expect(TRIPO_MODEL_VERSION).toMatch(/^v3\.\d/)
  })

  it('never asks for quad (V3 quad forces FBX; GLB -> STL needs GLB)', () => {
    for (const cfg of Object.values(SIZE_TIERS)) {
      expect(buildImageToModelRequest({ imageUrl: 'https://x.test/a.png', tier: cfg.tier }, cfg)).not.toHaveProperty('quad')
    }
  })
})

describe('buildImageToModelRequest', () => {
  it('toys keep their tier texture on V3: HD tiers ask for detailed, with PBR', () => {
    const body = buildImageToModelRequest({ imageUrl: 'https://x.test/c.png', tier: 'small' }, SIZE_TIERS.small)
    expect(body).toEqual({
      input: 'https://x.test/c.png',
      model: TRIPO_MODEL_VERSION,
      face_limit: SIZE_TIERS.small.faceLimit,
      texture: true,
      pbr: true,
      auto_size: true,
      texture_quality: 'detailed',
      orientation: 'align_image'
    })
    expect(tierTextureMode(SIZE_TIERS.mini)).toBe('standard')
  })

  it("Mini-Me white asks for NO texture: texture AND pbr false (pbr defaults true and would force texture back on)", () => {
    const body = buildImageToModelRequest({ imageUrl: 'https://x.test/c.png', tier: 'small', texture: 'none' }, SIZE_TIERS.small)
    expect(body.texture).toBe(false)
    expect(body.pbr).toBe(false)
    expect(body).not.toHaveProperty('texture_quality')
    expect(body).not.toHaveProperty('orientation') // only effective with texture
  })

  it('Mini-Me full color keeps standard texture', () => {
    const body = buildImageToModelRequest({ imageUrl: 'https://x.test/c.png', tier: 'medium', texture: 'standard' }, SIZE_TIERS.medium)
    expect(body.texture).toBe(true)
    expect(body.texture_quality).toBe('standard')
  })

  it('maps seed to model_seed (V3 name)', () => {
    const body = buildImageToModelRequest({ imageUrl: 'u', tier: 'mini', seed: 7 }, SIZE_TIERS.mini)
    expect(body.model_seed).toBe(7)
    expect(body).not.toHaveProperty('seed')
  })
})

describe('parseTripoTask', () => {
  it('reads the documented success shape', () => {
    const t = parseTripoTask({
      code: 0,
      data: {
        task_id: 'task_abc123',
        type: 'image_to_model',
        status: 'success',
        progress: 100,
        output: { model_url: 'https://cdn.tripo3d.ai/output/model_pbr.glb', rendered_image_url: 'https://cdn.tripo3d.ai/output/preview.png' },
        credits_consumed: 30.0,
        created_at: '2026-04-28T12:00:00Z',
        completed_at: '2026-04-28T12:01:30Z'
      }
    })
    expect(t).toEqual({
      status: 'success',
      progress: 100,
      modelUrl: 'https://cdn.tripo3d.ai/output/model_pbr.glb',
      previewUrl: 'https://cdn.tripo3d.ai/output/preview.png',
      creditsConsumed: 30,
      error: undefined
    })
  })

  it('reads running and failed states, and an error envelope', () => {
    expect(parseTripoTask({ code: 0, data: { status: 'running', progress: 40 } }).status).toBe('running')
    expect(parseTripoTask({ code: 0, data: { status: 'failed', error_msg: 'bad image' } }).error).toBe('bad image')
    const err = parseTripoTask({ code: 2010, message: 'Insufficient credits', suggestion: 'Please top up your account' })
    expect(err.status).toBe('unknown')
    expect(err.error).toBe('Insufficient credits')
  })
})
