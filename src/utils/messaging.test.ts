// Unit tests for the pure, DB-free helpers in messaging.ts. The class
// methods themselves are thin Supabase query wrappers (integration-shaped,
// not unit-shaped) — real correctness there is covered by the manual RLS
// proof plan in the task handoff, plus tsc. These tests cover the two things
// that are pure logic: conversation-pair canonicalization and row mapping.

import { describe, it, expect } from 'vitest'
import { sortParticipantIds, mapMessageRow, mapConversationRow } from './messaging'

describe('sortParticipantIds', () => {
  it('returns the same order regardless of which id is passed first', () => {
    const a = 'aaaaaaaa-0000-0000-0000-000000000001'
    const b = 'bbbbbbbb-0000-0000-0000-000000000002'
    expect(sortParticipantIds(a, b)).toEqual([a, b])
    expect(sortParticipantIds(b, a)).toEqual([a, b])
  })

  it('is stable for already-sorted input', () => {
    const a = '11111111-0000-0000-0000-000000000000'
    const b = '22222222-0000-0000-0000-000000000000'
    expect(sortParticipantIds(a, b)).toEqual([a, b])
  })
})

describe('mapMessageRow', () => {
  it('maps a DB row to the app Message shape', () => {
    const row = {
      id: 'msg-1',
      conversation_id: 'conv-1',
      sender_id: 'user-a',
      recipient_id: 'user-b',
      content: 'hello',
      message_type: 'text',
      attachments: [],
      metadata: {},
      is_read: false,
      created_at: '2026-07-27T00:00:00Z',
      updated_at: null
    }

    const message = mapMessageRow(row)

    expect(message).toEqual({
      id: 'msg-1',
      conversationId: 'conv-1',
      senderId: 'user-a',
      recipientId: 'user-b',
      content: 'hello',
      messageType: 'text',
      attachments: undefined,
      metadata: undefined,
      isRead: false,
      createdAt: '2026-07-27T00:00:00Z',
      updatedAt: null
    })
  })

  it('preserves non-empty attachments and metadata', () => {
    const row = {
      id: 'msg-2',
      conversation_id: 'conv-1',
      sender_id: 'user-a',
      recipient_id: 'user-b',
      content: 'sent a file',
      message_type: 'file',
      attachments: [{ id: 'att_1', type: 'file', name: 'a.pdf', url: '', size: 10, mimeType: 'application/pdf' }],
      metadata: { orderId: 'order-1' },
      is_read: true,
      created_at: '2026-07-27T00:00:00Z',
      updated_at: '2026-07-27T00:01:00Z'
    }

    const message = mapMessageRow(row)

    expect(message.attachments).toHaveLength(1)
    expect(message.metadata).toEqual({ orderId: 'order-1' })
    expect(message.isRead).toBe(true)
  })
})

describe('mapConversationRow', () => {
  const participantDetails: Conversation_ParticipantDetails = [
    { userId: 'user-a', name: 'Alice', email: 'alice@example.com', role: 'customer' },
    { userId: 'user-b', name: 'Bob', email: 'bob@example.com', role: 'vendor' }
  ]

  it('marks isArchived true only for a user present in archived_by', () => {
    const row = {
      id: 'conv-1',
      participant_one: 'user-a',
      participant_two: 'user-b',
      tags: ['product_inquiry'],
      archived_by: ['user-b'],
      created_at: '2026-07-27T00:00:00Z',
      updated_at: '2026-07-27T00:00:00Z'
    }

    const forUserA = mapConversationRow(row, participantDetails, 'user-a')
    const forUserB = mapConversationRow(row, participantDetails, 'user-b')

    expect(forUserA.isArchived).toBe(false)
    expect(forUserB.isArchived).toBe(true)
    expect(forUserA.participants).toEqual(['user-a', 'user-b'])
    expect(forUserA.tags).toEqual(['product_inquiry'])
  })

  it('defaults unreadCount to 0 and lastMessage to undefined when omitted', () => {
    const row = {
      id: 'conv-2',
      participant_one: 'user-a',
      participant_two: 'user-b',
      tags: [],
      archived_by: [],
      created_at: '2026-07-27T00:00:00Z',
      updated_at: '2026-07-27T00:00:00Z'
    }

    const conversation = mapConversationRow(row, participantDetails, 'user-a')

    expect(conversation.unreadCount).toBe(0)
    expect(conversation.lastMessage).toBeUndefined()
  })
})

// Local alias just for the test's readability — matches
// Conversation['participantDetails'] in src/types/index.ts.
type Conversation_ParticipantDetails = Array<{
  userId: string
  name: string
  email: string
  role: string
  profileImage?: string
}>
