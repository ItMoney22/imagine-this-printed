import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Private 3D model files (Watchtower task 1417e863, 2026-10-07).
//
// What must hold: meshes are saved to the PRIVATE bucket and the DB gets a
// gs:// reference (never a URL); a link exists only when signed, and a row's
// reference can only ever sign that model's OWN object, in our own buckets.
// ---------------------------------------------------------------------------

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const uploads: { bucket: string; path: string; contentType: string; bytes: number }[] = []
const signs: { bucket: string; path: string; ttl: number; downloadName?: string }[] = []
vi.mock('./google-cloud-storage.js', () => ({
  uploadBufferToBucket: async (bucket: string, buf: Buffer, path: string, contentType: string) => {
    uploads.push({ bucket, path, contentType, bytes: buf.length })
    return path
  },
  signObjectInBucket: async (bucket: string, path: string, ttl: number, downloadName?: string) => {
    signs.push({ bucket, path, ttl, downloadName })
    return `https://signed.test/${bucket}/${path}?ttl=${ttl}`
  },
}))
vi.mock('../lib/supabase.js', () => ({ supabase: { from: () => { throw new Error('no db here') } } }))

const mf = await import('./model-files.js')
const ID = '2d7eaa60-fb44-4a12-9357-cebeccb408f5'
const PRIVATE = 'imagine-this-printed-products'
const PUBLIC = 'imagine-this-printed-main'

beforeEach(() => {
  uploads.length = 0
  signs.length = 0
})

describe('model file references', () => {
  it('stores a mesh in the private bucket and returns a gs:// reference, not a URL', async () => {
    const ref = await mf.storeModelFile(Buffer.from('solid x'), mf.modelFilePath(ID, 'stl'), 'stl')
    expect(ref).toBe(`gs://${PRIVATE}/3d-models/${ID}/model.stl`)
    expect(uploads).toEqual([{ bucket: PRIVATE, path: `3d-models/${ID}/model.stl`, contentType: 'model/stl', bytes: 7 }])
  })

  it('parses gs:// refs and the legacy https storage URLs older rows carried', () => {
    expect(mf.parseModelFileRef(`gs://${PRIVATE}/3d-models/${ID}/model.glb`)).toEqual({ bucket: PRIVATE, path: `3d-models/${ID}/model.glb` })
    expect(mf.parseModelFileRef(`https://storage.googleapis.com/${PUBLIC}/3d-models/${ID}/model.stl?X-Goog-Signature=abc`))
      .toEqual({ bucket: PUBLIC, path: `3d-models/${ID}/model.stl` })
  })

  it('refuses other buckets, other hosts, traversal and junk', () => {
    expect(mf.parseModelFileRef('gs://someone-elses-bucket/3d-models/x/model.stl')).toBeNull()
    expect(mf.parseModelFileRef('https://evil.test/imagine-this-printed-products/x.stl')).toBeNull()
    expect(mf.parseModelFileRef(`gs://${PRIVATE}/3d-models/../print-files/a.png`)).toBeNull()
    expect(mf.parseModelFileRef(`gs://${PRIVATE}`)).toBeNull()
    expect(mf.parseModelFileRef(null)).toBeNull()
    expect(mf.parseModelFileRef(42)).toBeNull()
  })
})

describe('signing', () => {
  it("signs a model row's own mesh short-lived, with a save-as name when asked", async () => {
    const url = await mf.signOwnModelFile(
      { id: ID, stl_url: `gs://${PRIVATE}/3d-models/${ID}/model.stl` }, 'stl', { downloadName: 'figurine-2d7eaa60.stl' })
    expect(url).toBe(`https://signed.test/${PRIVATE}/3d-models/${ID}/model.stl?ttl=60`)
    expect(signs[0]).toEqual({ bucket: PRIVATE, path: `3d-models/${ID}/model.stl`, ttl: 60, downloadName: 'figurine-2d7eaa60.stl' })
  })

  it("will not sign a row whose reference points at anything but that model's own file", async () => {
    // e.g. a row edited to point at a creator's private print file
    const url = await mf.signOwnModelFile(
      { id: ID, stl_url: `gs://${PRIVATE}/print-files/merch-studio/darrell/aJCwdWaaoI/front.png` }, 'stl')
    expect(url).toBeNull()
    const other = await mf.signOwnModelFile({ id: ID, glb_url: `gs://${PRIVATE}/3d-models/another-id/model.glb` }, 'glb')
    expect(other).toBeNull()
    expect(signs).toEqual([])
  })

  it('preview shape: GLB as a short-lived link, the STL reference removed', async () => {
    const row = { id: ID, prompt: 'robo', glb_url: `gs://${PRIVATE}/3d-models/${ID}/model.glb`, stl_url: `gs://${PRIVATE}/3d-models/${ID}/model.stl` }
    const out = await mf.withPreviewLinks(row)
    expect(out.glb_url).toBe(`https://signed.test/${PRIVATE}/3d-models/${ID}/model.glb?ttl=60`)
    expect(out.stl_url).toBeNull()
    expect(out.prompt).toBe('robo')
  })

  it('print floor: our refs are signed fresh, a creator-hosted https mesh passes through, junk is dropped', async () => {
    expect(await mf.meshLinkFor(`gs://${PRIVATE}/print-files/merch-studio/darrell/b1/model.stl`, 720))
      .toBe(`https://signed.test/${PRIVATE}/print-files/merch-studio/darrell/b1/model.stl?ttl=720`)
    expect(await mf.meshLinkFor('https://cdn.darrell.test/meshes/m.stl', 720)).toBe('https://cdn.darrell.test/meshes/m.stl')
    expect(await mf.meshLinkFor('https://storage.googleapis.com/not-ours/m.stl', 720)).toBeUndefined()
    expect(await mf.meshLinkFor(null, 720)).toBeUndefined()
  })
})
