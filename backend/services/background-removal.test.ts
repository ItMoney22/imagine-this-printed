import { describe, it, expect, vi, beforeEach } from 'vitest'
import sharp from 'sharp'

const removeBackgroundSync = vi.fn()
vi.mock('./replicate.js', () => ({ removeBackgroundSync: (...a: any[]) => removeBackgroundSync(...a) }))

const { removeBackgroundToBuffer } = await import('./background-removal.js')

const W = 80
async function png(px: (x: number, y: number) => [number, number, number]): Promise<Buffer> {
  const raw = Buffer.alloc(W * W * 3)
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const [r, g, b] = px(x, y); const i = (y * W + x) * 3
    raw[i] = r; raw[i + 1] = g; raw[i + 2] = b
  }
  return sharp(raw, { raw: { width: W, height: W, channels: 3 } }).png().toBuffer()
}
const box = (x: number, y: number, x0: number, y0: number, x1: number, y1: number) =>
  x >= x0 && x <= x1 && y >= y0 && y <= y1

function serve(body: Buffer | null, ok = true) {
  return vi.fn(async () => ({ ok, status: ok ? 200 : 500, arrayBuffer: async () => body!.buffer.slice(body!.byteOffset, body!.byteOffset + body!.byteLength) })) as any
}

/** Serve the source first, then the segmentation mask - the order the module fetches them. */
function serveThen(...bodies: Buffer[]) {
  let call = 0
  return vi.fn(async () => {
    const b = bodies[Math.min(call++, bodies.length - 1)]
    return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }
  }) as any
}

/** An RGBA png: alpha comes from `a`, so a fixture can act as a segmentation mask. */
async function masked(a: (x: number, y: number) => number): Promise<Buffer> {
  const raw = Buffer.alloc(W * W * 4)
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4
    raw[i] = raw[i + 1] = raw[i + 2] = 30; raw[i + 3] = a(x, y)
  }
  return sharp(raw, { raw: { width: W, height: W, channels: 4 } }).png().toBuffer()
}

beforeEach(() => { removeBackgroundSync.mockReset() })

describe('removeBackgroundToBuffer', () => {
  // Segmentation is consulted on every solid-field design, but only ever to ADD
  // ink inside the cut. Here it does what it really does to this artwork - keeps
  // the subject, deletes the detached island - and the island survives anyway.
  it('colour-keys a solid background and lets no mask delete detached artwork', async () => {
    // Subject plus a detached island - the shape AI segmentation throws away.
    const src = await png((x, y) => box(x, y, 15, 15, 45, 45) || box(x, y, 65, 65, 75, 75) ? [255, 255, 255] : [0, 0, 0])
    const subjectOnly = await masked((x, y) => box(x, y, 15, 15, 45, 45) ? 255 : 0)
    global.fetch = serveThen(src, subjectOnly)
    removeBackgroundSync.mockResolvedValue('https://replicate.test/mask.png')
    const out = await removeBackgroundToBuffer('https://example.test/design.png')
    expect(out.method).toBe('color-key')
    expect(out.background).toBe('black')
    const { data } = await sharp(out.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const alpha = (x: number, y: number) => data[(y * W + x) * 4 + 3]
    expect(alpha(30, 30)).toBe(255) // subject
    expect(alpha(70, 70)).toBe(255) // the detached island survives
    expect(alpha(2, 2)).toBe(0)     // background gone
  })

  // Art that runs off the edge of the frame must not push the design onto the
  // AI path. This is the Gnome Abduction shape: a flat black field, a beam
  // crossing the bottom edge, and a speech bubble floating free in a corner -
  // exactly what segmentation throws away.
  it('still colour-keys when artwork bleeds off the edge of the frame', async () => {
    const src = await png((x, y) => {
      if (y > 56 && x >= 22 && x <= 59) return [140, 200, 60]
      if (box(x, y, 6, 16, 22, 30)) return [255, 255, 255]
      if (box(x, y, 32, 24, 56, 52)) return [230, 60, 60]
      return [0, 0, 0]
    })
    global.fetch = serve(src)
    removeBackgroundSync.mockRejectedValue(new Error('no mask in this test'))
    const out = await removeBackgroundToBuffer('https://example.test/beam.png')
    expect(out.method).toBe('color-key')
    const { data } = await sharp(out.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect(data[(22 * W + 14) * 4 + 3]).toBe(255) // the free-floating bubble survives
  })

  // Black line work on a black field is the same pixels as the background, so
  // the key drains it out with the field. Segmentation knows the subject's
  // shape and keeps it - that ink, and only that ink, comes back.
  it('lets segmentation restore field-coloured ink inside the artwork', async () => {
    // A white shape with a black bar drawn across the inside of it: the bar is
    // real ink, but it is the field's colour, so the key cannot tell it from
    // background. It stops short of the shape's edges, which is what makes it
    // ink INSIDE the artwork rather than a gap that splits it in two.
    const bar = (x: number, y: number) => box(x, y, 28, 38, 52, 42)
    const src = await png((x, y) => box(x, y, 20, 20, 60, 60) && !bar(x, y) ? [255, 255, 255] : [0, 0, 0])
    const mask = await masked((x, y) => box(x, y, 20, 20, 60, 60) ? 255 : 0)  // segmentation keeps the whole shape
    global.fetch = serveThen(src, mask)
    removeBackgroundSync.mockResolvedValue('https://replicate.test/mask.png')
    const out = await removeBackgroundToBuffer('https://example.test/lineart.png')
    expect(out.method).toBe('color-key+ai-ink')
    const { data } = await sharp(out.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect(data[(40 * W + 40) * 4 + 3]).toBe(255) // the bar is ink again
    expect(data[(2 * W + 2) * 4 + 3]).toBe(0)     // the field is still gone
  })

  // If the second opinion is unavailable the cut still ships - it is a correct
  // cut, just a thinner one on line art.
  it('ships the keyed cut when the ink pass fails', async () => {
    const src = await png((x, y) => box(x, y, 15, 15, 45, 45) ? [255, 255, 255] : [0, 0, 0])
    global.fetch = serve(src)
    removeBackgroundSync.mockRejectedValue(new Error('replicate down'))
    const out = await removeBackgroundToBuffer('https://example.test/design.png')
    expect(out.method).toBe('color-key')
    const { data } = await sharp(out.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect(data[(30 * W + 30) * 4 + 3]).toBe(255)
  })

  it('falls back to AI segmentation for a photographic source', async () => {
    const photo = await png((x, y) => [120 + (x % 40), 90 + (y % 50), 60 + ((x * y) % 70)])
    const aiOut = await png(() => [10, 20, 30])
    let call = 0
    global.fetch = vi.fn(async () => {
      const body = call++ === 0 ? photo : aiOut
      return { ok: true, status: 200, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) }
    }) as any
    removeBackgroundSync.mockResolvedValue('https://replicate.test/out.png')
    const out = await removeBackgroundToBuffer('https://example.test/photo.png')
    expect(out.method).toBe('ai-segmentation')
    expect(out.background).toBeNull()
    expect(removeBackgroundSync).toHaveBeenCalledWith('https://example.test/photo.png')
  })

  // The source fetch is retried once before giving up, because falling back
  // here downgrades the design to the tool that deletes detached artwork.
  it('retries the source fetch once before falling back', async () => {
    const good = await png((x, y) => box(x, y, 15, 15, 45, 45) ? [255, 255, 255] : [0, 0, 0])
    let call = 0
    global.fetch = vi.fn(async () => call++ === 0
      ? { ok: false, status: 503, arrayBuffer: async () => new ArrayBuffer(0) }
      : { ok: true, status: 200, arrayBuffer: async () => good.buffer.slice(good.byteOffset, good.byteOffset + good.byteLength) }) as any
    removeBackgroundSync.mockRejectedValue(new Error('not part of this test'))
    const out = await removeBackgroundToBuffer('https://example.test/flaky.png')
    expect(out.method).toBe('color-key')
  })

  it('falls back to AI segmentation only when both source attempts fail', async () => {
    const aiOut = await png(() => [1, 2, 3])
    let call = 0
    global.fetch = vi.fn(async () => call++ < 2
      ? { ok: false, status: 403, arrayBuffer: async () => new ArrayBuffer(0) }
      : { ok: true, status: 200, arrayBuffer: async () => aiOut.buffer.slice(aiOut.byteOffset, aiOut.byteOffset + aiOut.byteLength) }) as any
    removeBackgroundSync.mockResolvedValue('https://replicate.test/out.png')
    const out = await removeBackgroundToBuffer('https://example.test/gone.png')
    expect(out.method).toBe('ai-segmentation')
    expect(removeBackgroundSync).toHaveBeenCalled()
  })
})
