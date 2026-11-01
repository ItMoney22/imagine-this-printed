// Etsy personalization answers (task 5d007181): the multi-question format from
// Etsy's personalization migration guide, read 2026-11-01.
import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import {
  decodeEtsyText,
  downloadUpload,
  isAllowedUploadUrl,
  readPersonalization,
  typedAnswer,
  uploadUrls,
} from './etsy-personalization.js'

const PHOTO_URL = 'https://i.etsystatic.com/uploads/abc123/pet.jpg'

// The two answers the pet ornament listing (4607572810) asks for, as Etsy returns them:
// several objects share property_id 54, the label is the seller's own, the upload is a URL,
// and the text is HTML-escaped.
const txn = {
  variations: [
    { property_id: 200, value_id: 1, formatted_name: 'Primary color', formatted_value: 'Red' },
    { property_id: 54, value_id: null, formatted_name: 'Your pet&#39;s name', formatted_value: 'Mr. Biscuit' },
    { property_id: 54, value_id: null, formatted_name: 'A photo of your pet', formatted_value: PHOTO_URL },
  ],
} as any

describe('decodeEtsyText', () => {
  it('undoes the escaping Etsy applies to answers and labels', () => {
    expect(decodeEtsyText('Your pet&#39;s name')).toBe("Your pet's name")
    expect(decodeEtsyText('Salt &amp; Pepper')).toBe('Salt & Pepper')
    expect(decodeEtsyText('&quot;Bo&quot; &#x27;Jr&#x27;')).toBe('"Bo" \'Jr\'')
    expect(decodeEtsyText('caf&eacute;')).toBe('caf&eacute;') // unknown entity: left as typed
    expect(decodeEtsyText(undefined)).toBe('')
  })
})

describe('readPersonalization', () => {
  it('reads every property_id 54 answer and nothing else', () => {
    const answers = readPersonalization(txn)
    expect(answers).toEqual([
      { label: "Your pet's name", value: 'Mr. Biscuit', urls: [] },
      { label: 'A photo of your pet', value: PHOTO_URL, urls: [PHOTO_URL] },
    ])
  })

  it('still reads the old single "Personalization" box', () => {
    const answers = readPersonalization({ variations: [{ formatted_name: 'Personalization', formatted_value: 'Luna' }] } as any)
    expect(typedAnswer(answers)).toBe('Luna')
  })

  it('skips empty answers and copes with no variations at all', () => {
    expect(readPersonalization({ variations: [{ property_id: 54, formatted_name: 'Name', formatted_value: '  ' }] } as any)).toEqual([])
    expect(readPersonalization({} as any)).toEqual([])
  })

  it('finds the name by its label, not by its position', () => {
    const swapped = { variations: [txn.variations[2], txn.variations[1]] } as any
    const answers = readPersonalization(swapped)
    expect(typedAnswer(answers)).toBe('Mr. Biscuit')
    expect(uploadUrls(answers)).toEqual([PHOTO_URL])
  })

  it('collects several uploaded files, in order, once each', () => {
    const multi = {
      variations: [
        { property_id: 54, formatted_name: 'Photos', formatted_value: `${PHOTO_URL}, https://i.etsystatic.com/uploads/two.png` },
        { property_id: 54, formatted_name: 'Again', formatted_value: PHOTO_URL },
      ],
    } as any
    expect(uploadUrls(readPersonalization(multi))).toEqual([PHOTO_URL, 'https://i.etsystatic.com/uploads/two.png'])
  })
})

describe('isAllowedUploadUrl', () => {
  it("fetches only Etsy's own https hosts", () => {
    expect(isAllowedUploadUrl(PHOTO_URL, '')).toBe(true)
    expect(isAllowedUploadUrl('https://www.etsy.com/your/files/1', '')).toBe(true)
    expect(isAllowedUploadUrl('http://i.etsystatic.com/x.jpg', '')).toBe(false)
    expect(isAllowedUploadUrl('https://etsy.com.evil.example/x.jpg', '')).toBe(false)
    expect(isAllowedUploadUrl('https://notetsy.com/x.jpg', '')).toBe(false)
    expect(isAllowedUploadUrl('https://169.254.169.254/latest', '')).toBe(false)
    expect(isAllowedUploadUrl('not a url', '')).toBe(false)
  })

  it('takes extra hosts from ETSY_UPLOAD_HOSTS', () => {
    expect(isAllowedUploadUrl('https://cdn.example.net/a.jpg', 'cdn.example.net, other.example')).toBe(true)
  })
})

describe('downloadUpload', () => {
  const pngBytes = () => sharp({ create: { width: 300, height: 300, channels: 3, background: '#c08040' } }).png().toBuffer()
  const ok = (body: Buffer, headers: Record<string, string> = {}) => new Response(new Uint8Array(body), { status: 200, headers })

  it('downloads a photo with a plain GET', async () => {
    const body = await pngBytes()
    const calls: any[] = []
    const file = await downloadUpload(PHOTO_URL, { fetch: (async (url: any, init: any) => { calls.push([url, init]); return ok(body) }) as any })
    expect(file.contentType).toBe('image/png')
    expect(file.bytes.equals(body)).toBe(true)
    expect(file.authed).toBe(false)
    expect(calls[0][1].headers.Authorization).toBeUndefined()
  })

  it('asks again with the Etsy API headers when Etsy refuses, and only then', async () => {
    const body = await pngBytes()
    const calls: any[] = []
    const file = await downloadUpload(PHOTO_URL, {
      fetch: (async (url: any, init: any) => {
        calls.push([url, init])
        return calls.length === 1 ? new Response('no', { status: 403 }) : ok(body)
      }) as any,
      etsyHeaders: async () => ({ 'x-api-key': 'k:s', Authorization: 'Bearer t' }),
    })
    expect(file.authed).toBe(true)
    expect(calls).toHaveLength(2)
    expect(calls[1][1].headers.Authorization).toBe('Bearer t')
  })

  it('never fetches a host that is not Etsy (a buyer can type any link)', async () => {
    let fetched = false
    await expect(
      downloadUpload('https://evil.example/cat.jpg', { fetch: (async () => { fetched = true; return new Response('') }) as any })
    ).rejects.toThrow(/evil\.example.*not an Etsy address/)
    expect(fetched).toBe(false)
  })

  it('refuses a file that is not a JPEG, PNG or WebP', async () => {
    await expect(
      downloadUpload(PHOTO_URL, { fetch: (async () => ok(Buffer.from('<html>login</html>'), { 'content-type': 'text/html' })) as any })
    ).rejects.toThrow(/not a JPEG, PNG or WebP photo \(Etsy says text\/html\)/)
  })

  it('refuses a file over 12 MB before reading it', async () => {
    await expect(
      downloadUpload(PHOTO_URL, { fetch: (async () => ok(Buffer.alloc(10), { 'content-length': String(13 * 1024 * 1024) })) as any })
    ).rejects.toThrow(/over the/)
  })

  it('says what Etsy answered on a failed download', async () => {
    await expect(downloadUpload(PHOTO_URL, { fetch: (async () => new Response('', { status: 404 })) as any })).rejects.toThrow(/404/)
  })
})
