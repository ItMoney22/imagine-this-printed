// Tests for Mr. Imagine's cheap/expensive model routing (Watchtower task
// 07a9198c-efa8-4809-afc5-c36eefa55340).
//
// chat-model-routing.ts is dependency-free — no Supabase, no OpenAI client, no
// env — so a plain static import works here, same as order-status.test.ts.
//
// The two failure modes are asymmetric and both are money/quality bugs:
//   false negative (image turn -> flash)  = vision request sent to the cheap model
//   false positive (text turn  -> pro)    = ~20x overpay on every mascot reply
// so every case below is written as one or the other.

import { describe, it, expect } from 'vitest'
import {
  OPENROUTER_TEXT_MODEL,
  OPENROUTER_VISION_MODEL,
  messagesContainImage,
  pickOpenRouterChatModel
} from './chat-model-routing.js'

// Exactly the shape backend/routes/ai/mr-imagine-chat.ts builds.
const systemMessage = { role: 'system', content: 'You are Mr. Imagine.' }
const textTurn = { role: 'user', content: 'Make me a dragon on a black tee' }
const imageTurn = {
  role: 'user',
  content: [
    { type: 'text', text: 'What do you think of this?' },
    { type: 'image_url', image_url: { url: 'https://storage.googleapis.com/itp/ref.png' } }
  ]
}

describe('messagesContainImage — text turns must NOT be seen as images', () => {
  it('returns false for a plain text conversation', () => {
    expect(messagesContainImage([systemMessage, textTurn])).toBe(false)
  })

  it('returns false when history mentions an image in prose', () => {
    // CreateDesignModal.tsx:576 appends the literal string ' [+ image attached]'
    // to history entries. A naive substring check would route every later turn
    // in that conversation to pro forever.
    const history = [
      systemMessage,
      { role: 'user', content: 'What do you think of this? [+ image attached]' },
      { role: 'assistant', content: 'I love the image_url you sent!' },
      textTurn
    ]
    expect(messagesContainImage(history)).toBe(false)
  })

  it('returns false for an image_url part with a blank url', () => {
    // Reachable: refs are filtered with Boolean, so '   ' survives.
    const blank = { role: 'user', content: [{ type: 'image_url', image_url: { url: '   ' } }] }
    expect(messagesContainImage([systemMessage, blank])).toBe(false)
  })

  it('returns false for a multimodal turn that carries only text parts', () => {
    const textOnlyParts = { role: 'user', content: [{ type: 'text', text: 'hello' }] }
    expect(messagesContainImage([systemMessage, textOnlyParts])).toBe(false)
  })
})

describe('messagesContainImage — image turns MUST be detected', () => {
  it('detects an image in the current turn', () => {
    expect(messagesContainImage([systemMessage, imageTurn])).toBe(true)
  })

  it('detects an image carried in replayed conversation history', () => {
    // The current frontend only replays strings, but the route passes history
    // content through verbatim. If a client ever replays a multimodal turn,
    // routing on the current turn's refs alone would send image content to the
    // text model. Scanning the whole payload is what makes that safe.
    const history = [systemMessage, imageTurn, { role: 'assistant', content: 'Nice!' }, textTurn]
    expect(messagesContainImage(history)).toBe(true)
  })

  it('detects an image among several attachments', () => {
    const multi = {
      role: 'user',
      content: [
        { type: 'text', text: 'compare these' },
        { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
        { type: 'image_url', image_url: { url: 'https://example.com/b.png' } }
      ]
    }
    expect(messagesContainImage([systemMessage, multi])).toBe(true)
  })

  it('detects a data: URL attachment', () => {
    const dataUrl = {
      role: 'user',
      content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } }]
    }
    expect(messagesContainImage([systemMessage, dataUrl])).toBe(true)
  })
})

describe('messagesContainImage — malformed input never throws', () => {
  it('handles non-arrays, nulls and junk parts', () => {
    expect(messagesContainImage(undefined)).toBe(false)
    expect(messagesContainImage(null)).toBe(false)
    expect(messagesContainImage('not messages')).toBe(false)
    expect(messagesContainImage([null, undefined, 42, { role: 'user' }])).toBe(false)
    expect(messagesContainImage([{ role: 'user', content: [null, 'raw string', 7] }])).toBe(false)
    expect(messagesContainImage([{ role: 'user', content: [{ type: 'image_url' }] }])).toBe(false)
    expect(messagesContainImage([{ role: 'user', content: [{ type: 'image_url', image_url: null }] }])).toBe(false)
  })
})

describe('pickOpenRouterChatModel', () => {
  it('sends a text-only turn to flash', () => {
    expect(pickOpenRouterChatModel([systemMessage, textTurn])).toBe(OPENROUTER_TEXT_MODEL)
  })

  it('sends an image turn to pro', () => {
    expect(pickOpenRouterChatModel([systemMessage, imageTurn])).toBe(OPENROUTER_VISION_MODEL)
  })

  it('pins the model ids so a silent rename cannot flip the cost profile', () => {
    expect(OPENROUTER_TEXT_MODEL).toBe('google/gemini-2.5-flash')
    expect(OPENROUTER_VISION_MODEL).toBe('google/gemini-2.5-pro')
  })
})
