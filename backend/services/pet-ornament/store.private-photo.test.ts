import { beforeEach, describe, expect, it, vi } from 'vitest'

const storePrivateFile = vi.fn()
const uploadImageFromBuffer = vi.fn()
vi.mock('../private-files.js', () => ({ storePrivateFile: (...a: any[]) => storePrivateFile(...a) }))
vi.mock('../google-cloud-storage.js', () => ({ uploadImageFromBuffer: (...a: any[]) => uploadImageFromBuffer(...a) }))
vi.mock('../gcs-storage.js', () => ({ downloadFile: vi.fn(), fileExists: vi.fn(), generateSignedUrl: vi.fn() }))

import { blobStore, photoPath, portraitPngPath } from './store.js'

beforeEach(() => {
  storePrivateFile.mockReset().mockResolvedValue('gs://private/x')
  uploadImageFromBuffer.mockReset().mockResolvedValue({ publicUrl: 'u', path: 'p' })
})

describe('where a pet ornament file goes (task 4c100f9f)', () => {
  it("keeps the customer's photo in the private bucket", async () => {
    await blobStore.write(Buffer.from('x'), photoPath('abc', 'png'), 'image/png')
    expect(storePrivateFile).toHaveBeenCalledWith(expect.any(Buffer), 'users/pet-ornaments/photos/abc.png', 'image/png')
    expect(uploadImageFromBuffer).not.toHaveBeenCalled()
  })

  it('leaves the drawn portrait where the order flow reads it', async () => {
    await blobStore.write(Buffer.from('x'), portraitPngPath('abc'), 'image/png')
    expect(uploadImageFromBuffer).toHaveBeenCalledTimes(1)
    expect(storePrivateFile).not.toHaveBeenCalled()
  })
})
