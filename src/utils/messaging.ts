import { supabase } from '../lib/supabase'
import api from '../lib/api'
import type { Message, Conversation, MessageAttachment } from '../types'

export interface MessageData {
  content: string
  messageType: 'text' | 'image' | 'file' | 'product_inquiry' | 'order_update'
  attachments?: File[]
  metadata?: {
    productId?: string
    orderId?: string
    [key: string]: any
  }
}

export interface ConversationCreateData {
  participantId: string
  initialMessage?: MessageData
  context?: {
    type: 'product_inquiry' | 'order_support' | 'general'
    productId?: string
    orderId?: string
  }
}

// ---------------------------------------------------------------------------
// Pure helpers — exported so they're unit-testable without a Supabase client.
// ---------------------------------------------------------------------------

/**
 * Canonicalize a pair of user ids so the same two users always resolve to
 * the same (participant_one, participant_two) order, regardless of who
 * looks up or creates the conversation first. Matches the
 * `conversations_unique_pair UNIQUE (participant_one, participant_two)`
 * constraint in docs/sql/2026-07-27-messaging-crm-tables.sql.
 */
export function sortParticipantIds(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a]
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/**
 * Resolve a fresh, short-lived signed download URL for a message attachment.
 * Attachments are stored privately (gcsPath only, see uploadAttachments) —
 * this always mints a new URL server-side, after the backend confirms the
 * caller is the sender or recipient of the message the attachment belongs
 * to. Throws if the attachment is missing, unavailable (e.g. a legacy row
 * from before real uploads existed), or the caller isn't a participant.
 */
export async function getAttachmentDownloadUrl(
  attachmentId: string
): Promise<{ url: string; name: string; mimeType: string }> {
  const { data } = await api.get(`/api/messaging/attachments/${attachmentId}`)
  return data
}

export function mapMessageRow(row: any): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    content: row.content,
    messageType: row.message_type,
    attachments: Array.isArray(row.attachments) && row.attachments.length > 0 ? row.attachments : undefined,
    metadata: row.metadata && Object.keys(row.metadata).length > 0 ? row.metadata : undefined,
    isRead: !!row.is_read,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function mapConversationRow(
  row: any,
  participantDetails: Conversation['participantDetails'],
  currentUserId: string,
  lastMessage?: Message,
  unreadCount = 0
): Conversation {
  return {
    id: row.id,
    participants: [row.participant_one, row.participant_two],
    participantDetails,
    lastMessage,
    unreadCount,
    isArchived: Array.isArray(row.archived_by) && row.archived_by.includes(currentUserId),
    tags: row.tags || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export class MessagingService {
  // Create or get existing conversation. Real table lookup — a pair of
  // users always maps to one canonicalized row (see sortParticipantIds).
  async getOrCreateConversation(
    userId: string,
    participantId: string,
    context?: ConversationCreateData['context']
  ): Promise<Conversation> {
    try {
      const [participantOne, participantTwo] = sortParticipantIds(userId, participantId)

      const { data: existing, error: findError } = await supabase
        .from('conversations')
        .select('*')
        .eq('participant_one', participantOne)
        .eq('participant_two', participantTwo)
        .maybeSingle()

      if (findError) throw findError

      let row = existing
      if (!row) {
        const { data: created, error: insertError } = await supabase
          .from('conversations')
          .insert({
            participant_one: participantOne,
            participant_two: participantTwo,
            tags: context ? [context.type] : []
          })
          .select()
          .single()

        if (insertError) throw insertError
        row = created
      }

      const participantDetails = await this.getParticipantDetails([userId, participantId])
      return mapConversationRow(row, participantDetails, userId)
    } catch (error) {
      console.error('Error creating conversation:', error)
      throw new Error('Failed to create conversation')
    }
  }

  // Send a message — persists to the messages table (previously logged to
  // console and discarded).
  async sendMessage(
    conversationId: string,
    senderId: string,
    messageData: MessageData
  ): Promise<Message> {
    try {
      const recipientId = await this.getOtherParticipant(conversationId, senderId)

      const attachments = messageData.attachments
        ? await this.uploadAttachments(messageData.attachments, conversationId)
        : undefined

      const { data, error } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          sender_id: senderId,
          recipient_id: recipientId,
          content: messageData.content,
          message_type: messageData.messageType,
          attachments: attachments || [],
          metadata: messageData.metadata || {}
        })
        .select()
        .single()

      if (error) throw error

      // Bump the conversation so it sorts to the top of getConversations().
      await supabase
        .from('conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', conversationId)

      return mapMessageRow(data)
    } catch (error) {
      console.error('Error sending message:', error)
      throw new Error('Failed to send message')
    }
  }

  // Get messages for a conversation — real query, RLS-scoped to participants.
  async getMessages(
    conversationId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<Message[]> {
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .range(offset, offset + limit - 1)

      if (error) throw error

      return (data || []).map(mapMessageRow)
    } catch (error) {
      console.error('Error fetching messages:', error)
      throw new Error('Failed to fetch messages')
    }
  }

  // Get conversations for a user — real query, RLS-scoped to participants.
  async getConversations(
    userId: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<Conversation[]> {
    try {
      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .or(`participant_one.eq.${userId},participant_two.eq.${userId}`)
        .order('updated_at', { ascending: false })
        .range(offset, offset + limit - 1)

      if (error) throw error

      const rows = (data || []).filter(row => !(row.archived_by || []).includes(userId))

      return await Promise.all(
        rows.map(async row => {
          const otherUserId = row.participant_one === userId ? row.participant_two : row.participant_one
          const [participantDetails, lastMessageRow, unreadCount] = await Promise.all([
            this.getParticipantDetails([userId, otherUserId]),
            this.getLastMessage(row.id),
            this.countUnread(row.id, userId)
          ])

          return mapConversationRow(
            row,
            participantDetails,
            userId,
            lastMessageRow ? mapMessageRow(lastMessageRow) : undefined,
            unreadCount
          )
        })
      )
    } catch (error) {
      console.error('Error fetching conversations:', error)
      throw new Error('Failed to fetch conversations')
    }
  }

  // Mark messages as read — real update, scoped to the recipient (RLS also
  // enforces this: only the recipient can flip is_read).
  async markAsRead(conversationId: string, userId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('messages')
        .update({ is_read: true })
        .eq('conversation_id', conversationId)
        .eq('recipient_id', userId)
        .eq('is_read', false)

      if (error) throw error
    } catch (error) {
      console.error('Error marking messages as read:', error)
      throw new Error('Failed to mark messages as read')
    }
  }

  // Archive conversation — per-user (archived_by array), never deletes the
  // row or hides it for the other participant.
  async archiveConversation(conversationId: string, userId: string): Promise<void> {
    try {
      const { data: row, error: fetchError } = await supabase
        .from('conversations')
        .select('archived_by')
        .eq('id', conversationId)
        .single()

      if (fetchError) throw fetchError

      const archivedBy = Array.from(new Set([...(row?.archived_by || []), userId]))

      const { error: updateError } = await supabase
        .from('conversations')
        .update({ archived_by: archivedBy })
        .eq('id', conversationId)

      if (updateError) throw updateError
    } catch (error) {
      console.error('Error archiving conversation:', error)
      throw new Error('Failed to archive conversation')
    }
  }

  // Get unread message count — real count query for the authenticated user.
  async getUnreadCount(userId: string): Promise<number> {
    try {
      const { count, error } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_id', userId)
        .eq('is_read', false)

      if (error) throw error

      return count || 0
    } catch (error) {
      console.error('Error getting unread count:', error)
      return 0
    }
  }

  // Search messages across the user's own conversations.
  async searchMessages(
    userId: string,
    query: string,
    limit: number = 20
  ): Promise<Message[]> {
    try {
      const conversations = await this.getConversations(userId)
      const allMessages: Message[] = []

      for (const conversation of conversations) {
        const messages = await this.getMessages(conversation.id)
        allMessages.push(...messages)
      }

      return allMessages
        .filter(message =>
          message.content.toLowerCase().includes(query.toLowerCase())
        )
        .slice(0, limit)
    } catch (error) {
      console.error('Error searching messages:', error)
      throw new Error('Failed to search messages')
    }
  }

  // Private helper methods

  private async getParticipantDetails(userIds: string[]): Promise<Conversation['participantDetails']> {
    const uniqueIds = Array.from(new Set(userIds))

    const { data, error } = await supabase
      .from('user_profiles')
      .select('id, username, display_name, first_name, last_name, email, role, avatar_url')
      .in('id', uniqueIds)

    if (error) {
      console.error('Error fetching participant details:', error)
      return uniqueIds.map(id => ({ userId: id, name: 'Unknown', email: '', role: 'customer' }))
    }

    const byId = new Map((data || []).map((p: any) => [p.id, p]))

    return uniqueIds.map(id => {
      const profile: any = byId.get(id)
      const name =
        profile?.display_name ||
        profile?.username ||
        (profile?.first_name && profile?.last_name ? `${profile.first_name} ${profile.last_name}` : undefined) ||
        profile?.email?.split('@')[0] ||
        'Unknown'

      return {
        userId: id,
        name,
        email: profile?.email || '',
        role: profile?.role || 'customer',
        profileImage: profile?.avatar_url || undefined
      }
    })
  }

  private async getLastMessage(conversationId: string): Promise<any | null> {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      console.error('Error fetching last message:', error)
      return null
    }

    return data
  }

  private async countUnread(conversationId: string, userId: string): Promise<number> {
    const { count, error } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversationId)
      .eq('recipient_id', userId)
      .eq('is_read', false)

    if (error) {
      console.error('Error counting unread messages:', error)
      return 0
    }

    return count || 0
  }

  private async getOtherParticipant(conversationId: string, currentUserId: string): Promise<string> {
    const { data, error } = await supabase
      .from('conversations')
      .select('participant_one, participant_two')
      .eq('id', conversationId)
      .single()

    if (error || !data) {
      throw new Error('Conversation not found')
    }

    return data.participant_one === currentUserId ? data.participant_two : data.participant_one
  }

  // Uploads each file to GCS via the backend (backend/routes/messaging.ts —
  // the frontend has no GCS credentials). Any single failed upload rejects
  // the whole call; sendMessage()'s try/catch then blocks the send entirely
  // rather than persisting a message that claims an attachment it doesn't
  // have (Watchtower task 2f4f06ea deliverable: fail closed, not silently).
  private async uploadAttachments(files: File[], conversationId: string): Promise<MessageAttachment[]> {
    return Promise.all(
      files.map(async (file): Promise<MessageAttachment> => {
        const dataUrl = await fileToBase64(file)
        const { data } = await api.post('/api/messaging/attachments/upload', {
          conversationId,
          filename: file.name,
          file: dataUrl
        })

        // `url` is intentionally left empty — attachments are private and
        // resolved on demand via getAttachmentDownloadUrl(id), never stored
        // as a durable link (see backend route for why: a public/long-lived
        // URL is unacceptable for message attachments).
        return {
          id: data.id,
          type: data.type,
          name: data.name,
          url: '',
          size: data.size,
          mimeType: data.mimeType,
          gcsPath: data.gcsPath
        }
      })
    )
  }

  // Quick message templates for common scenarios
  getQuickReplyTemplates(context: 'product_inquiry' | 'order_support' | 'general'): string[] {
    const templates = {
      product_inquiry: [
        "Thank you for your interest! I'd be happy to help you with a custom design.",
        "Could you provide more details about what you're looking for?",
        "I can definitely help with that. What's your timeline and budget?",
        "Let me send you some examples of similar work I've done."
      ],
      order_support: [
        "I'm looking into your order status and will update you shortly.",
        "Your order is currently being processed and should ship within 2-3 business days.",
        "I apologize for any inconvenience. Let me resolve this for you right away.",
        "Thank you for bringing this to my attention. I'm investigating now."
      ],
      general: [
        "Thanks for reaching out!",
        "I'll get back to you with more information soon.",
        "Let me check on that for you.",
        "Is there anything else I can help you with?"
      ]
    }

    return templates[context] || templates.general
  }
}

export const messagingService = new MessagingService()
