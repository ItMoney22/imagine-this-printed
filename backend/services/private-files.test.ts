import { beforeEach, describe, expect, it, vi } from 'vitest'

const upload = vi.fn()
const sign = vi.fn()
vi.mock('./google-cloud-storage.js', () => ({
  uploadBufferToBucket: (...a: any[]) => upload(...a),
  signObjectInBucket: (...a: any[]) => sign(...a),
}))

import {
  FORWARD_LINK_TTL_MINUTES,
  PRIVATE_FILES_BUCKET,
  isPrivateRef,
  linkForStoredFile,
  privateRefPath,
  storePrivateDataUrl,
  storePrivateFile,
  withAttachmentLinks,
} from './private-files.js'

const REF = `gs://${PRIVATE_FILES_BUCKET}/users/inbound/email-attachments/a-0-x.png`
const PATH = 'users/inbound/email-attachments/a-0-x.png'

beforeEach(() => {
  upload.mockReset().mockResolvedValue(PATH)
  sign.mockReset().mockResolvedValue('https://signed.example/x')
})

describe('references', () => {
  it('knows its own bucket and no other', () => {
    expect(isPrivateRef(REF)).toBe(true)
    expect(privateRefPath(REF)).toBe(PATH)
    expect(isPrivateRef('gs://imagine-this-printed-main/users/a.png')).toBe(false)
    expect(isPrivateRef('gs://someone-else/a.png')).toBe(false)
    expect(isPrivateRef('https://storage.googleapis.com/x/a.png')).toBe(false)
  })

  it('refuses a path that climbs out', () => {
    expect(isPrivateRef(`gs://${PRIVATE_FILES_BUCKET}/users/../secret.png`)).toBe(false)
  })
})

describe('storing', () => {
  it('writes to the private bucket and returns a reference, not a link', async () => {
    const ref = await storePrivateFile(Buffer.from('x'), PATH, 'image/png')
    expect(upload).toHaveBeenCalledWith(PRIVATE_FILES_BUCKET, expect.any(Buffer), PATH, 'image/png')
    expect(ref).toBe(REF)
  })

  it('decodes a data URL and hands back a link for the next step', async () => {
    const out = await storePrivateDataUrl('data:image/png;base64,aGk=', PATH, 5)
    expect(upload.mock.calls[0][1].toString()).toBe('hi')
    expect(upload.mock.calls[0][3]).toBe('image/png')
    expect(sign).toHaveBeenCalledWith(PRIVATE_FILES_BUCKET, PATH, 5)
    expect(out).toEqual({ ref: REF, url: 'https://signed.example/x' })
  })

  it('refuses anything that is not a data URL', async () => {
    await expect(storePrivateDataUrl('https://example.com/a.png', PATH)).rejects.toThrow(/data URL/)
    expect(upload).not.toHaveBeenCalled()
  })
})

describe('linkForStoredFile', () => {
  it('signs a reference', async () => {
    expect(await linkForStoredFile(REF)).toBe('https://signed.example/x')
    expect(sign).toHaveBeenCalledWith(PRIVATE_FILES_BUCKET, PATH, 60, undefined)
  })

  it('passes an older stored link through unsigned', async () => {
    const old = 'https://storage.googleapis.com/imagine-this-printed-main/users/a.png?Signature=y'
    expect(await linkForStoredFile(old)).toBe(old)
    expect(sign).not.toHaveBeenCalled()
  })

  it('will not sign a reference into another bucket', async () => {
    expect(await linkForStoredFile('gs://someone-else/a.png')).toBeNull()
    expect(sign).not.toHaveBeenCalled()
  })

  it('answers null when signing fails or there is no value', async () => {
    sign.mockRejectedValueOnce(new Error('no'))
    expect(await linkForStoredFile(REF)).toBeNull()
    expect(await linkForStoredFile(null)).toBeNull()
    expect(await linkForStoredFile('')).toBeNull()
  })
})

describe('withAttachmentLinks', () => {
  it('never leaves a reference in what a reader gets', async () => {
    const out = await withAttachmentLinks([
      { filename: 'a.png', url: REF },
      { filename: 'old.png', url: 'https://example.com/old.png' },
      { filename: 'bytes-only.png' },
    ])
    expect(out.map((a) => a.url)).toEqual(['https://signed.example/x', 'https://example.com/old.png', undefined])
  })

  it('keeps the name when a link cannot be made', async () => {
    sign.mockRejectedValueOnce(new Error('no'))
    expect(await withAttachmentLinks([{ filename: 'a.png', url: REF }])).toEqual([{ filename: 'a.png', url: undefined }])
  })

  it('gives a forward days, and takes a missing list', async () => {
    await withAttachmentLinks([{ url: REF }], FORWARD_LINK_TTL_MINUTES)
    expect(sign).toHaveBeenCalledWith(PRIVATE_FILES_BUCKET, PATH, 7 * 24 * 60, undefined)
    expect(await withAttachmentLinks(null)).toEqual([])
  })
})
