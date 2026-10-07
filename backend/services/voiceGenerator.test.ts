import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { ttsText, speechBody, synthesizeSpeech, generateVoiceResponse, isPersona, PERSONAS, TTS_MODELS } from './voiceGenerator.js'

// Mr. and Mrs. Imagine on Gemini 3.8 Flash TTS: the request each persona sends, the text clean-up, and the
// main-model -> Flash-Lite backup. Gemini itself is faked; the live voices were ear-checked by hand (see the header).

const audio = (bytes: string) => ({
  ok: true,
  status: 200,
  json: async () => ({ steps: [{ type: 'model_output', content: [{ type: 'audio', data: Buffer.from(bytes).toString('base64') }] }] }),
  text: async () => '',
})
const fail = (status: number, body = 'nope') => ({ ok: false, status, json: async () => ({}), text: async () => body })

let fetchMock: ReturnType<typeof vi.fn>
const savedKey = process.env.GOOGLE_API_KEY
beforeEach(() => {
  process.env.GOOGLE_API_KEY = 'test-key'
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  if (savedKey === undefined) delete process.env.GOOGLE_API_KEY
  else process.env.GOOGLE_API_KEY = savedKey
})

describe('ttsText', () => {
  it('turns old MiniMax pause markers into Gemini pauses', () => {
    expect(ttsText('Hi!<#0.3#> Ready?<#1.5#> Go')).toBe('Hi! <short pause> Ready? <long pause> Go')
  })
  it('keeps tags Gemini performs and drops the rest', () => {
    expect(ttsText('Wow <giggle> that is <b>bold</b>')).toBe('Wow <giggle> that is bold')
  })
  it('leaves the words alone', () => {
    expect(ttsText("Let's mix that D N A!")).toBe("Let's mix that D N A!")
  })
})

describe('speechBody', () => {
  it('Mr. Imagine reads in Puck with his mascot style, as MP3', () => {
    const b = speechBody('Hiya, friend!', 'mr-imagine')
    expect(b.model).toBe('gemini-3.8-flash-tts')
    expect(b.generation_config.speech_config[0].voice).toBe('Puck')
    expect(b.input[0].content[0].annotations[0].style).toMatch(/high-pitched/)
    expect(b.response_format).toEqual({ type: 'audio', mime_type: 'audio/mp3' })
  })
  it('Mrs. Imagine reads in Laomedeia', () => {
    expect(speechBody('Hello, sweetie!', 'mrs-imagine').generation_config.speech_config[0].voice).toBe('Laomedeia')
  })
})

describe('isPersona', () => {
  it('accepts only the two Imagines (an old MiniMax voice id is not one)', () => {
    expect(isPersona('mr-imagine')).toBe(true)
    expect(isPersona('mrs-imagine')).toBe(true)
    expect(isPersona('moss_audio_737a299c-734a-11f0-918f-4e0486034804')).toBe(false)
    expect(isPersona('toString')).toBe(false)
  })
  it('every persona has a voice and a one-line style', () => {
    for (const p of Object.values(PERSONAS)) expect(p.voice && p.style && !p.style.includes('\n')).toBeTruthy()
  })
})

describe('synthesizeSpeech', () => {
  it('sends the key and returns the MP3 bytes', async () => {
    fetchMock.mockResolvedValueOnce(audio('ID3mp3'))
    const out = await synthesizeSpeech('Hi', 'mr-imagine')
    expect(out.toString()).toBe('ID3mp3')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions')
    expect(init.headers['x-goog-api-key']).toBe('test-key')
  })
  it('moves the same line to Flash-Lite when the main model is at its cap', async () => {
    fetchMock.mockResolvedValueOnce(fail(429)).mockResolvedValueOnce(audio('lite'))
    expect((await synthesizeSpeech('Hi')).toString()).toBe('lite')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).model).toBe(TTS_MODELS[1])
  })
  it('does not retry a bad request', async () => {
    fetchMock.mockResolvedValueOnce(fail(400, 'bad voice'))
    await expect(synthesizeSpeech('Hi')).rejects.toThrow(/400.*bad voice/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('says so when every model is out', async () => {
    fetchMock.mockResolvedValue(fail(503))
    await expect(synthesizeSpeech('Hi')).rejects.toThrow(/503 on gemini-3.8-flash-lite-tts/)
  })
  it('refuses without a key', async () => {
    delete process.env.GOOGLE_API_KEY
    await expect(synthesizeSpeech('Hi')).rejects.toThrow(/GOOGLE_API_KEY/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('generateVoiceResponse', () => {
  it('returns a playable MP3 data URL, Mr. Imagine by default', async () => {
    fetchMock.mockResolvedValueOnce(audio('ID3'))
    const url = await generateVoiceResponse('Hiya!')
    expect(url).toBe(`data:audio/mpeg;base64,${Buffer.from('ID3').toString('base64')}`)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).generation_config.speech_config[0].voice).toBe('Puck')
  })
  it('speaks as Mrs. Imagine when asked', async () => {
    fetchMock.mockResolvedValueOnce(audio('ID3'))
    await generateVoiceResponse('Hello!', { persona: 'mrs-imagine' })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).generation_config.speech_config[0].voice).toBe('Laomedeia')
  })
  it('refuses text over 10,000 characters before calling Gemini', async () => {
    await expect(generateVoiceResponse('a'.repeat(10001))).rejects.toThrow(/10,000/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
