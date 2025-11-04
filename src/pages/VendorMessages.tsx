import React, { useState, useEffect, useRef } from 'react'
import { useAuth } from '../context/SupabaseAuthContext'
import { messagingService } from '../utils/messaging'
import type { Conversation, Message } from '../types'

const VendorMessages: React.FC = () => {
  const { user } = useAuth()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTag, setSelectedTag] = useState<string>('all')
  const [showQuickReplies, setShowQuickReplies] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (user) {
      loadConversations()
    }
  }, [user])

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  useEffect(() => {
    if (selectedConversation) {
      loadMessages(selectedConversation.id)
      markAsRead(selectedConversation.id)
    }
  }, [selectedConversation])

  const loadConversations = async () => {
    if (!user) return
    
    try {
      setIsLoading(true)
      const data = await messagingService.getConversations(user.id)
      setConversations(data)
      
      if (data.length > 0 && !selectedConversation) {
        setSelectedConversation(data[0])
      }
    } catch (error) {
      console.error('Error loading conversations:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const loadMessages = async (conversationId: string) => {
    try {
      const data = await messagingService.getMessages(conversationId)
      setMessages(data)
    } catch (error) {
      console.error('Error loading messages:', error)
    }
  }

  const sendMessage = async (content?: string) => {
    const messageContent = content || newMessage.trim()
    if (!selectedConversation || !messageContent || !user || isSending) return

    try {
      setIsSending(true)
      const message = await messagingService.sendMessage(
        selectedConversation.id,
        user.id,
        {
          content: messageContent,
          messageType: 'text'
        }
      )

      setMessages(prev => [...prev, message])
      setNewMessage('')
      setShowQuickReplies(false)
      
      // Update conversation list
      loadConversations()
    } catch (error) {
      console.error('Error sending message:', error)
      alert('Failed to send message. Please try again.')
    } finally {
      setIsSending(false)
    }
  }

  const markAsRead = async (conversationId: string) => {
    if (!user) return
    
    try {
      await messagingService.markAsRead(conversationId, user.id)
      
      // Update local conversation state
      setConversations(prev =>
        prev.map(conv =>
          conv.id === conversationId
            ? { ...conv, unreadCount: 0 }
            : conv
        )
      )
    } catch (error) {
      console.error('Error marking as read:', error)
    }
  }

  const archiveConversation = async (conversationId: string) => {
    try {
      await messagingService.archiveConversation(conversationId, user!.id)
      setConversations(prev => prev.filter(conv => conv.id !== conversationId))
      setSelectedConversation(null)
    } catch (error) {
      console.error('Error archiving conversation:', error)
    }
  }

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files || !selectedConversation || !user) return

    try {
      setIsSending(true)
      const fileArray = Array.from(files)
      
      const message = await messagingService.sendMessage(
        selectedConversation.id,
        user.id,
        {
          content: `Sent ${fileArray.length} file(s)`,
          messageType: 'file',
          attachments: fileArray
        }
      )

      setMessages(prev => [...prev, message])
      loadConversations()
    } catch (error) {
      console.error('Error uploading files:', error)
      alert('Failed to upload files. Please try again.')
    } finally {
      setIsSending(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const getQuickReplies = () => {
    const conversationType = selectedConversation?.tags[0] || 'general'
    return messagingService.getQuickReplyTemplates(
      conversationType as 'product_inquiry' | 'order_support' | 'general'
    )
  }

  const filteredConversations = conversations.filter(conv => {
    const matchesSearch = conv.participantDetails.some(p => 
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.email.toLowerCase().includes(searchQuery.toLowerCase())
    )
    
    const matchesTag = selectedTag === 'all' || conv.tags.includes(selectedTag)
    
    return matchesSearch && matchesTag
  })

  const tagCounts = conversations.reduce((acc, conv) => {
    conv.tags.forEach(tag => {
      acc[tag] = (acc[tag] || 0) + 1
    })
    return acc
  }, {} as Record<string, number>)

  if (!user) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
          <p className="text-yellow-800">Please sign in to access vendor messages.</p>
        </div>
      </div>
    )
  }

  if (user.role !== 'vendor' && user.role !== 'admin' && user.role !== 'founder') {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <p className="text-red-800">Access denied. Vendor access required.</p>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-text">Vendor Messages</h1>
        <p className="text-muted">Manage customer inquiries and support requests</p>
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-card rounded-lg shadow p-4">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-muted">Total Conversations</p>
              <p className="text-lg font-semibold text-text">{conversations.length}</p>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-lg shadow p-4">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-muted">Unread</p>
              <p className="text-lg font-semibold text-text">
                {conversations.reduce((sum, conv) => sum + conv.unreadCount, 0)}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-lg shadow p-4">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-muted">Product Inquiries</p>
              <p className="text-lg font-semibold text-text">{tagCounts.product_inquiry || 0}</p>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-lg shadow p-4">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192L5.636 18.364M12 12h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-muted">Support Requests</p>
              <p className="text-lg font-semibold text-text">{tagCounts.order_support || 0}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-card rounded-lg shadow h-[700px] flex">
        {/* Conversations Sidebar */}
        <div className="w-1/3 border-r card-border flex flex-col">
          {/* Search and Filters */}
          <div className="p-4 border-b card-border space-y-3">
            <input
              type="text"
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-3 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            
            <select
              value={selectedTag}
              onChange={(e) => setSelectedTag(e.target.value)}
              className="w-full px-3 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              <option value="all">All Conversations ({conversations.length})</option>
              <option value="product_inquiry">Product Inquiries ({tagCounts.product_inquiry || 0})</option>
              <option value="order_support">Order Support ({tagCounts.order_support || 0})</option>
              <option value="general">General ({tagCounts.general || 0})</option>
            </select>
          </div>

          {/* Conversations List */}
          <div className="flex-1 overflow-y-auto">
            {filteredConversations.length === 0 ? (
              <div className="p-4 text-center text-muted">
                <svg className="w-12 h-12 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <p>No conversations found</p>
              </div>
            ) : (
              filteredConversations.map((conversation) => {
                const customer = conversation.participantDetails.find(p => p.userId !== user.id)
                
                return (
                  <div
                    key={conversation.id}
                    onClick={() => setSelectedConversation(conversation)}
                    className={`p-4 border-b border-gray-100 cursor-pointer hover:bg-card ${
                      selectedConversation?.id === conversation.id ? 'bg-purple-50 border-purple-200' : ''
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <div className="relative">
                        <img
                          src={customer?.profileImage || 'https://via.placeholder.com/40x40?text=C'}
                          alt={customer?.name}
                          className="w-10 h-10 rounded-full object-cover"
                        />
                        {conversation.unreadCount > 0 && (
                          <div className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
                            {conversation.unreadCount}
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium text-text truncate">
                            {customer?.name}
                          </p>
                          <div className="text-xs text-gray-400">
                            {conversation.lastMessage ? 
                              new Date(conversation.lastMessage.createdAt).toLocaleDateString() : 
                              new Date(conversation.createdAt).toLocaleDateString()
                            }
                          </div>
                        </div>
                        <p className="text-sm text-muted truncate">
                          {conversation.lastMessage?.content || 'No messages yet'}
                        </p>
                        <div className="flex items-center space-x-2 mt-1">
                          {conversation.tags.map(tag => (
                            <span
                              key={tag}
                              className={`text-xs px-2 py-1 rounded-full ${
                                tag === 'product_inquiry' ? 'bg-blue-100 text-blue-800' :
                                tag === 'order_support' ? 'bg-red-100 text-red-800' :
                                'bg-card text-muted'
                              }`}
                            >
                              {tag.replace('_', ' ')}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Messages Area */}
        <div className="flex-1 flex flex-col">
          {selectedConversation ? (
            <>
              {/* Message Header */}
              <div className="p-4 border-b card-border bg-card">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <img
                      src={selectedConversation.participantDetails.find(p => p.userId !== user.id)?.profileImage || 'https://via.placeholder.com/32x32?text=C'}
                      alt="Customer"
                      className="w-8 h-8 rounded-full object-cover"
                    />
                    <div>
                      <p className="font-medium text-text">
                        {selectedConversation.participantDetails.find(p => p.userId !== user.id)?.name}
                      </p>
                      <p className="text-sm text-muted">
                        {selectedConversation.participantDetails.find(p => p.userId !== user.id)?.email}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => archiveConversation(selectedConversation.id)}
                      className="text-gray-400 hover:text-muted"
                      title="Archive conversation"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8l6 6 6-6" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.map((message) => {
                  const isOwnMessage = message.senderId === user.id
                  
                  return (
                    <div
                      key={message.id}
                      className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                        isOwnMessage
                          ? 'bg-purple-600 text-white'
                          : 'bg-gray-200 text-text'
                      }`}>
                        <p className="text-sm">{message.content}</p>
                        {message.attachments && message.attachments.length > 0 && (
                          <div className="mt-2 space-y-2">
                            {message.attachments.map((attachment) => (
                              <div key={attachment.id} className="flex items-center space-x-2">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                                </svg>
                                <span className="text-xs">{attachment.name}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <p className="text-xs mt-1 opacity-75">
                          {new Date(message.createdAt).toLocaleTimeString()}
                        </p>
                      </div>
                    </div>
                  )
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Quick Replies */}
              {showQuickReplies && (
                <div className="p-4 border-t card-border bg-card">
                  <p className="text-sm font-medium text-text mb-2">Quick Replies:</p>
                  <div className="grid grid-cols-1 gap-2">
                    {getQuickReplies().map((reply, index) => (
                      <button
                        key={index}
                        onClick={() => sendMessage(reply)}
                        className="text-left p-2 text-sm bg-card border card-border rounded hover:bg-card"
                      >
                        {reply}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Message Input */}
              <div className="p-4 border-t card-border bg-card">
                <div className="flex items-end space-x-2">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2 text-gray-400 hover:text-muted"
                    disabled={isSending}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setShowQuickReplies(!showQuickReplies)}
                    className={`p-2 hover:text-muted ${showQuickReplies ? 'text-purple-600' : 'text-gray-400'}`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </button>
                  <div className="flex-1">
                    <textarea
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      onKeyPress={handleKeyPress}
                      placeholder="Type your message..."
                      rows={1}
                      className="w-full px-3 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
                      disabled={isSending}
                    />
                  </div>
                  <button
                    onClick={() => sendMessage()}
                    disabled={!newMessage.trim() || isSending}
                    className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSending ? (
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                      </svg>
                    )}
                  </button>
                </div>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  multiple
                  className="hidden"
                  accept="image/*,.pdf,.doc,.docx"
                />
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-muted">
                <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <h3 className="text-lg font-medium text-text mb-2">Select a conversation</h3>
                <p>Choose a conversation from the sidebar to start messaging</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default VendorMessages