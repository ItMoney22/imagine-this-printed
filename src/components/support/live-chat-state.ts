// The "talk to a person" side of the shop chat, as plain functions (tested in live-chat-state.test.ts).
//
// Stages a customer moves through once they ask for a person (task 5878a61f):
//   connecting -> waiting (Christina has the ping, nobody has answered) -> connected (her first reply landed)
//   -> ended (either side closed it).  'away' = nobody reachable: the ticket is filed and she answers by email.
// The live chat is saved in localStorage, so a customer who reloads or wanders to another page comes back to the
// same conversation instead of losing it.

export type HandoffStage = 'none' | 'connecting' | 'waiting' | 'connected' | 'away' | 'ended'

export const LIVE_CHAT_KEY = 'itp-live-chat'
/** A saved chat older than this is not resumed (the ticket still gets its email answer). */
export const LIVE_CHAT_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface SavedLiveChat {
  ticketId: string
  startedAt: string
  email?: string | null
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function loadLiveChat(storage: StorageLike | null | undefined, now = Date.now()): SavedLiveChat | null {
  try {
    const raw = storage?.getItem(LIVE_CHAT_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as SavedLiveChat
    if (!v || !UUID_RE.test(String(v.ticketId)) || !v.startedAt) return null
    if (now - Date.parse(v.startedAt) > LIVE_CHAT_MAX_AGE_MS) {
      storage?.removeItem(LIVE_CHAT_KEY)
      return null
    }
    return v
  } catch {
    return null
  }
}

export function saveLiveChat(storage: StorageLike | null | undefined, v: SavedLiveChat): void {
  try { storage?.setItem(LIVE_CHAT_KEY, JSON.stringify(v)) } catch { /* private mode: the chat still works, it just won't resume */ }
}

export function clearLiveChat(storage: StorageLike | null | undefined): void {
  try { storage?.removeItem(LIVE_CHAT_KEY) } catch { /* ignore */ }
}

/** Where the hand-off stands after a poll of /tickets/:id/messages/poll. */
export function stageFromPoll(
  current: HandoffStage,
  poll: { isLive?: boolean; sessionStatus?: string | null },
  hasPersonReply: boolean
): HandoffStage {
  if (current === 'none' || current === 'away' || current === 'ended') return current
  if (poll.sessionStatus === 'ended' || poll.isLive === false) return 'ended'
  if (hasPersonReply || poll.sessionStatus === 'active') return 'connected'
  return 'waiting'
}

/** "0:42", "3 min", "1 hr 5 min": how long they have been waiting. */
export function formatWait(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  if (s < 60) return `0:${String(s).padStart(2, '0')}`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest ? `${h} hr ${rest} min` : `${h} hr`
}

/** The one line under the waiting bar. It never promises a time we can't keep. */
export function waitingLine(seconds: number): string {
  if (seconds < 90) return 'She has your message on her phone now.'
  if (seconds < 15 * 60) return 'She will answer right here as soon as she can.'
  return 'Still on it. You can leave: her reply goes to your email too.'
}

export function isEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim())
}
