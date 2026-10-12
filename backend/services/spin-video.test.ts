import { describe, it, expect, vi } from 'vitest'

// spin-video.ts imports productPrintsOnBack from step-flow/shots, which pulls
// in supabase/replicate at module load. The planner itself is pure.
vi.mock('../lib/supabase.js', () => ({ supabase: {} }))
vi.mock('../worker/ai-jobs-worker.js', () => ({ processMockupJob: vi.fn() }))

import { planSpinVideo, SPIN_VIDEO_TWO_SIDED_MODEL, SPIN_VIDEO_MODEL } from './spin-video.js'

const FRONT = 'https://cdn/front-model.png'
const BACK = 'https://cdn/back-model.png'

const shotsWith = (back?: Record<string, unknown>) => ({
  model: { status: 'done', approved: true, url: FRONT, assetId: 'front-asset' },
  ...(back ? { 'model-back': back } : {}),
})

describe('planSpinVideo', () => {
  it('reads print_locations — a back recorded only as a placement still turns around', () => {
    // The route used to select `id, name, images, metadata` and pass
    // print_locations as undefined, so this product shot a front-only video.
    const plan = planSpinVideo({
      print_locations: ['front_image', 'back_image'],
      metadata: { step_flow: { shots: shotsWith() } },
    })
    if ('error' in plan) throw new Error(plan.error)
    expect(plan.twoSided).toBe(true)
    expect(plan.prompt).toContain('180 degrees')
  })

  it('animates front -> on-person back on a first+last-frame engine when the pair matches', () => {
    const plan = planSpinVideo({
      print_locations: ['front_image', 'back_image'],
      metadata: { step_flow: { shots: shotsWith({ status: 'done', url: BACK, sourceAssetId: 'front-asset' }) } },
    })
    if ('error' in plan) throw new Error(plan.error)
    expect(plan.backSource).toBe('paired')
    expect(plan.model).toBe(SPIN_VIDEO_TWO_SIDED_MODEL)
    expect(plan.input.start_image).toBe(FRONT)
    expect(plan.input.end_image).toBe(BACK)
    expect([5, 10]).toContain(plan.input.duration)
    expect(plan.warning).toBeUndefined()
  })

  it('refuses to pair a back rendered from an OLDER front take (it would be a different person)', () => {
    const plan = planSpinVideo({
      print_locations: ['back_image'],
      metadata: { step_flow: { shots: shotsWith({ status: 'done', url: BACK, sourceAssetId: 'old-front' }) } },
    })
    if ('error' in plan) throw new Error(plan.error)
    expect(plan.backSource).toBe('imagined')
    expect(plan.model).toBe(SPIN_VIDEO_MODEL)
  })

  it('says so out loud when a two-sided video has to imagine the back', () => {
    const plan = planSpinVideo({
      metadata: { print_artwork: { back_image: 'https://cdn/back-art.png' }, etsy_shots: { images: [FRONT] } },
    })
    if ('error' in plan) throw new Error(plan.error)
    expect(plan.backSource).toBe('imagined')
    expect(plan.warning).toMatch(/imagine the back/)
  })

  it('never puts a two-sided product in the open-jacket styling', () => {
    const plan = planSpinVideo(
      { print_locations: ['back_image'], metadata: { etsy_shots: { images: [FRONT] } } },
      () => 0 // would pick the jacket every time on a one-sided product
    )
    if ('error' in plan) throw new Error(plan.error)
    expect(plan.prompt).not.toMatch(/jacket/)
  })

  it('leaves one-sided products on the single-frame engine with no turn', () => {
    const plan = planSpinVideo({ print_locations: ['front_image'], metadata: { etsy_shots: { images: [FRONT] } } }, () => 0.9)
    if ('error' in plan) throw new Error(plan.error)
    expect(plan.twoSided).toBe(false)
    expect(plan.backSource).toBe('none')
    expect(plan.input.image).toBe(FRONT)
    expect(plan.prompt).not.toContain('180 degrees')
  })

  it('errors when there is nothing to animate', () => {
    expect(planSpinVideo({ metadata: {} })).toEqual({ error: expect.stringMatching(/shoot the model first/) })
  })
})
