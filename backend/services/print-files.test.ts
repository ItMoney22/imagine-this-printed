import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Private creator print files (Watchtower task b312de9c, 2026-10-07).
//
// What must hold: the print file lives in the PRIVATE bucket under
// print-files/, only paths are recorded (never a URL), and a link exists only
// when someone signs one. A sign failure on one placement must not cost the
// other, and a read failure must not take an order screen down.
// ---------------------------------------------------------------------------

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

let printFileRows: any[] = []
let readError: { message: string } | null = null
let upsertError: { message: string } | null = null
const upserts: { row: any; opts: any }[] = []
const uploads: { bucket: string; path: string; contentType: string }[] = []
let failSignFor: string | null = null

vi.mock('../lib/supabase.js', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'product_print_files') throw new Error(`unexpected table ${table}`)
      const chain: any = {
        select: () => chain,
        in: async (_col: string, ids: string[]) => ({
          data: readError ? null : printFileRows.filter(r => ids.includes(r.product_id)),
          error: readError,
        }),
        upsert: async (row: any, opts: any) => {
          upserts.push({ row, opts })
          return { error: upsertError }
        },
      }
      return chain
    },
  },
}))

vi.mock('./google-cloud-storage.js', () => ({
  uploadBufferToBucket: async (bucket: string, _buf: Buffer, path: string, contentType: string) => {
    uploads.push({ bucket, path, contentType })
    return path
  },
  signObjectInBucket: async (bucket: string, path: string, ttl: number) => {
    if (path === failSignFor) throw new Error('signing refused')
    return `https://signed.test/${bucket}/${path}?ttl=${ttl}`
  },
}))

const files = await import('./print-files.js')

beforeEach(() => {
  printFileRows = []
  readError = null
  upsertError = null
  upserts.length = 0
  uploads.length = 0
  failSignFor = null
})

describe('where a creator print file goes', () => {
  it('defaults to the private products bucket, not the public main bucket', () => {
    expect(files.PRINT_FILES_BUCKET).toBe('imagine-this-printed-products')
  })

  it('keeps print files under print-files/, away from the public mockups folder', () => {
    expect(files.printFilePath('darrell', 'aJCwdWaaoI', 'front')).toBe('print-files/merch-studio/darrell/aJCwdWaaoI/front.png')
    expect(files.printFilePath('darrell', 'aJCwdWaaoI', 'back')).toBe('print-files/merch-studio/darrell/aJCwdWaaoI/back.png')
  })

  it('stores the bytes in the private bucket and returns a path, not a URL', async () => {
    const path = await files.storePrintFile(Buffer.from('png'), 'print-files/merch-studio/darrell/b1/front.png')
    expect(path).toBe('print-files/merch-studio/darrell/b1/front.png')
    expect(uploads).toEqual([{ bucket: 'imagine-this-printed-products', path, contentType: 'image/png' }])
  })

  it('lists the placements a set of refs covers', () => {
    expect(files.placementsOf({ front: 'f' })).toEqual(['front'])
    expect(files.placementsOf({ front: 'f', back: null })).toEqual(['front'])
    expect(files.placementsOf({ front: 'f', back: 'b' })).toEqual(['front', 'back'])
  })

  it('recognises the refs shape an order line carries', () => {
    expect(files.isPrintFileRefs({ bucket: 'b', front: 'p' })).toBe(true)
    expect(files.isPrintFileRefs({ bucket: 'b', front: '' })).toBe(false)
    expect(files.isPrintFileRefs({ front: 'https://storage.googleapis.com/x' })).toBe(false)
    expect(files.isPrintFileRefs(null)).toBe(false)
  })
})

describe('recording and reading refs', () => {
  it('upserts bucket + paths keyed by product', async () => {
    await files.savePrintFileRefs('p1', { bucket: 'imagine-this-printed-products', front: 'print-files/a/front.png', back: null })
    expect(upserts).toHaveLength(1)
    expect(upserts[0].opts).toEqual({ onConflict: 'product_id' })
    expect(upserts[0].row).toMatchObject({
      product_id: 'p1',
      bucket: 'imagine-this-printed-products',
      front_path: 'print-files/a/front.png',
      back_path: null,
      source: 'merch-studio',
    })
    expect(JSON.stringify(upserts[0].row)).not.toMatch(/https?:/)
  })

  it('throws when the record cannot be written, so publish can undo the product', async () => {
    upsertError = { message: 'permission denied' }
    await expect(files.savePrintFileRefs('p1', { bucket: 'b', front: 'f' })).rejects.toThrow(/permission denied/)
  })

  it('reads refs for many products and skips incomplete rows', async () => {
    printFileRows = [
      { product_id: 'p1', bucket: 'b', front_path: 'print-files/p1/front.png', back_path: 'print-files/p1/back.png' },
      { product_id: 'p2', bucket: 'b', front_path: '', back_path: null },
    ]
    const refs = await files.getPrintFileRefsFor(['p1', 'p2', 'p3', 'p1'])
    expect(refs).toEqual({ p1: { bucket: 'b', front: 'print-files/p1/front.png', back: 'print-files/p1/back.png' } })
  })

  it('degrades to none found when the read fails', async () => {
    readError = { message: 'boom' }
    expect(await files.getPrintFileRefsFor(['p1'])).toEqual({})
  })

  it('does no read for an empty id list', async () => {
    expect(await files.getPrintFileRefsFor([])).toEqual({})
  })
})

describe('signing', () => {
  it('signs each placement for the press-floor lifetime by default', async () => {
    const signed = await files.signPrintFileRefs({ bucket: 'b', front: 'print-files/a/front.png', back: 'print-files/a/back.png' })
    expect(signed).toEqual({
      front: `https://signed.test/b/print-files/a/front.png?ttl=${files.PRINT_FILE_LINK_TTL_MINUTES}`,
      back: `https://signed.test/b/print-files/a/back.png?ttl=${files.PRINT_FILE_LINK_TTL_MINUTES}`,
    })
  })

  it('leaves out a placement that fails to sign instead of failing the caller', async () => {
    failSignFor = 'print-files/a/back.png'
    const signed = await files.signPrintFileRefs({ bucket: 'b', front: 'print-files/a/front.png', back: 'print-files/a/back.png' }, 60)
    expect(signed).toEqual({ front: 'https://signed.test/b/print-files/a/front.png?ttl=60' })
  })
})
