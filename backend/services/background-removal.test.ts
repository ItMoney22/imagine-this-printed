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

beforeEach(() => { removeBackgroundSync.mockReset() })

describe('removeBackgroundToBuffer', () => {
  it('colour-keys a solid background and never calls the AI segmenter', async () => {
    // Subject plus a detached island - the shape AI segmentation throws away.
    const src = await png((x, y) => box(x, y, 15, 15, 45, 45) || box(x, y, 65, 65, 75, 75) ? [255, 255, 255] : [0, 0, 0])
    global.fetch = serve(src)
    const out = await removeBackgroundToBuffer('https://example.test/design.png')
    expect(out.method).toBe('color-key')
    expect(out.background).toBe('black')
    expect(removeBackgroundSync).not.toHaveBeenCalled()
    const { data } = await sharp(out.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const alpha = (x: number, y: number) => data[(y * W + x) * 4 + 3]
    expect(alpha(30, 30)).toBe(255) // subject
    expect(alpha(70, 70)).toBe(255) // the detached island survives
    expect(alpha(2, 2)).toBe(0)     // background gone
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
    const out = await removeBackgroundToBuffer('https://example.test/flaky.png')
    expect(out.method).toBe('color-key')
    expect(removeBackgroundSync).not.toHaveBeenCalled()
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
