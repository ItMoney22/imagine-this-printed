import { describe, it, expect } from 'vitest'
import {
  LIVE_CHAT_KEY, clearLiveChat, formatWait, isEmail, loadLiveChat, saveLiveChat, stageFromPoll, waitingLine,
} from './live-chat-state'

function memoryStorage() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, removeItem: (k: string) => { m.delete(k) }, m }
}

const id = '61b69961-0000-4000-8000-000000000000'

describe('saved live chat', () => {
  it('round-trips so a reload resumes the same conversation', () => {
    const s = memoryStorage()
    saveLiveChat(s, { ticketId: id, startedAt: new Date().toISOString(), email: 'a@b.co' })
    expect(loadLiveChat(s)).toMatchObject({ ticketId: id, email: 'a@b.co' })
    clearLiveChat(s)
    expect(loadLiveChat(s)).toBeNull()
  })

  it('drops junk and chats older than three days', () => {
    const s = memoryStorage()
    s.setItem(LIVE_CHAT_KEY, '{"ticketId":"nope","startedAt":"2026-10-07T00:00:00Z"}')
    expect(loadLiveChat(s)).toBeNull()
    s.setItem(LIVE_CHAT_KEY, JSON.stringify({ ticketId: id, startedAt: '2026-10-01T00:00:00Z' }))
    expect(loadLiveChat(s, Date.parse('2026-10-07T00:00:00Z'))).toBeNull()
    expect(s.m.has(LIVE_CHAT_KEY)).toBe(false)
    s.setItem(LIVE_CHAT_KEY, '{not json')
    expect(loadLiveChat(s)).toBeNull()
  })

  it('survives a storage that throws (private mode)', () => {
    const bad = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') }, removeItem: () => { throw new Error('denied') } }
    expect(loadLiveChat(bad)).toBeNull()
    expect(() => saveLiveChat(bad, { ticketId: id, startedAt: 'x' })).not.toThrow()
    expect(() => clearLiveChat(bad)).not.toThrow()
  })
})

describe('stageFromPoll', () => {
  it('waits until Christina answers, then shows her as connected', () => {
    expect(stageFromPoll('connecting', { isLive: true, sessionStatus: 'waiting' }, false)).toBe('waiting')
    expect(stageFromPoll('waiting', { isLive: true, sessionStatus: 'waiting' }, true)).toBe('connected')
    expect(stageFromPoll('waiting', { isLive: true, sessionStatus: 'active' }, false)).toBe('connected')
  })

  it('ends when the session ends, and leaves the non-live stages alone', () => {
    expect(stageFromPoll('connected', { isLive: false, sessionStatus: 'ended' }, true)).toBe('ended')
    expect(stageFromPoll('away', { isLive: false }, false)).toBe('away')
    expect(stageFromPoll('none', { isLive: true }, false)).toBe('none')
  })
})

describe('wait copy', () => {
  it('formats the wait like a person would say it', () => {
    expect(formatWait(7)).toBe('0:07')
    expect(formatWait(185)).toBe('3 min')
    expect(formatWait(3900)).toBe('1 hr 5 min')
    expect(formatWait(7200)).toBe('2 hr')
  })

  it('never promises a time, and tells a long waiter they can leave', () => {
    for (const s of [10, 300, 3600]) expect(waitingLine(s)).not.toMatch(/\d+\s*(min|minute|second)/)
    expect(waitingLine(3600)).toMatch(/email/)
  })

  it('isEmail', () => {
    expect(isEmail(' a@b.co ')).toBe(true)
    expect(isEmail('a@b')).toBe(false)
  })
})
