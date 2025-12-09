import React, { useState, useEffect, useRef } from 'react'
import { chatbotService, type ChatMessage } from '../../utils/chatbot-service'
import { useAuth } from '../../context/SupabaseAuthContext'
import { MrImagineAvatar } from './MrImagineAvatar'
import { MR_IMAGINE_CONFIG, type MrImagineExpression } from './config'
import { Send, X, Trash2, Sparkles } from 'lucide-react'

export const MrImagineChatWidget: React.FC = () => {
  const { user } = useAuth()
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [hasNewMessage, setHasNewMessage] = useState(false)
  const [expression, setExpression] = useState<MrImagineExpression>('default')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMessages(chatbotService.getConversationHistory())
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  useEffect(() => {
    if (!isOpen && messages.length > 1) {
      setHasNewMessage(true)
    }
  }, [messages, isOpen])

  // Update expression based on state
  useEffect(() => {
    if (isLoading) {
      setExpression('thinking')
    } else if (hasNewMessage) {
      setExpression('happy')
    } else if (isOpen) {
      setExpression('default')
    } else {
      setExpression('waving')
    }
  }, [isLoading, hasNewMessage, isOpen])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const handleToggleChat = () => {
    setIsOpen(!isOpen)
    if (!isOpen) {
      setHasNewMessage(false)
      setExpression('happy')
      // Reset to default after greeting animation
      setTimeout(() => setExpression('default'), 1000)
    }
  }

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading) return

    const userMessage = inputValue.trim()
    setInputValue('')
    setIsLoading(true)
    setExpression('thinking')

    try {
      await chatbotService.sendMessage(userMessage, user?.email)
      setMessages([...chatbotService.getConversationHistory()])

      // Happy expression after successful response
      setExpression('happy')
      setTimeout(() => setExpression('default'), 2000)

      if (chatbotService.shouldEscalate(userMessage)) {
        setTimeout(async () => {
          await chatbotService.sendMessage(
            'The user wants to speak with human support',
            user?.email
          )
          setMessages([...chatbotService.getConversationHistory()])
        }, 1000)
      }
    } catch (error) {
      console.error('Failed to send message:', error)
      setExpression('confused')
      setTimeout(() => setExpression('default'), 2000)
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const clearChat = () => {
    chatbotService.clearConversation()
    setMessages(chatbotService.getConversationHistory())
    setExpression('happy')
    setTimeout(() => setExpression('default'), 1000)
  }

  // Don't render if no API key
  if (
    !import.meta.env.VITE_OPENAI_API_KEY ||
    import.meta.env.VITE_OPENAI_API_KEY === 'your_openai_api_key_here'
  ) {
    return null
  }

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {/* Chat Panel */}
      {isOpen && (
        <div className="mb-4 bg-card rounded-2xl shadow-2xl border border-primary/20 w-80 sm:w-96 h-[500px] flex flex-col overflow-hidden backdrop-blur-xl">
          {/* Header with Mr. Imagine */}
          <div className="bg-gradient-to-r from-primary to-secondary p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <MrImagineAvatar
                size="sm"
                pose="head"
                expression={expression}
                animate={false}
                glow={false}
              />
              <div>
                <h3 className="font-display text-white font-semibold tracking-wide">
                  {MR_IMAGINE_CONFIG.name}
                </h3>
                <p className="text-xs text-white/70 flex items-center gap-1">
                  <Sparkles className="w-3 h-3" />
                  Your creative assistant
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={clearChat}
                className="p-2 rounded-full hover:bg-white/20 transition-colors text-white/70 hover:text-white"
                title="Clear conversation"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              <button
                onClick={handleToggleChat}
                className="p-2 rounded-full hover:bg-white/20 transition-colors text-white/70 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-bg/80">
            {/* Welcome message if no messages */}
            {messages.length === 0 && (
              <div className="text-center py-8">
                <MrImagineAvatar
                  size="lg"
                  pose="waistUp"
                  expression="waving"
                  className="mx-auto mb-4"
                />
                <p className="text-muted text-sm">
                  {MR_IMAGINE_CONFIG.personality.greeting}
                </p>
                <p className="text-muted/60 text-xs mt-2">
                  Ask me anything about printing, designs, or orders!
                </p>
              </div>
            )}

            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${
                  message.role === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                {/* Mr. Imagine avatar for assistant messages */}
                {message.role === 'assistant' && (
                  <div className="mr-2 flex-shrink-0">
                    <MrImagineAvatar
                      size="sm"
                      pose="head"
                      expression="default"
                      animate={false}
                      glow={false}
                    />
                  </div>
                )}

                <div
                  className={`max-w-[75%] px-4 py-3 rounded-2xl text-sm ${
                    message.role === 'user'
                      ? 'bg-primary text-white rounded-br-md'
                      : 'bg-card border border-primary/10 text-text rounded-bl-md'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{message.content}</p>
                  <p
                    className={`text-xs mt-2 ${
                      message.role === 'user' ? 'text-white/60' : 'text-muted'
                    }`}
                  >
                    {formatTime(message.timestamp)}
                  </p>
                </div>
              </div>
            ))}

            {/* Loading indicator */}
            {isLoading && (
              <div className="flex justify-start">
                <div className="mr-2 flex-shrink-0">
                  <MrImagineAvatar
                    size="sm"
                    pose="head"
                    expression="thinking"
                    animate={true}
                    glow={false}
                  />
                </div>
                <div className="bg-card border border-primary/10 px-4 py-3 rounded-2xl rounded-bl-md">
                  <div className="flex space-x-1.5">
                    <div className="w-2 h-2 bg-primary/60 rounded-full animate-bounce"></div>
                    <div
                      className="w-2 h-2 bg-primary/60 rounded-full animate-bounce"
                      style={{ animationDelay: '0.1s' }}
                    ></div>
                    <div
                      className="w-2 h-2 bg-primary/60 rounded-full animate-bounce"
                      style={{ animationDelay: '0.2s' }}
                    ></div>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="p-4 border-t border-primary/10 bg-card">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Type your message..."
                className="flex-1 bg-bg border border-primary/20 rounded-xl px-4 py-3 text-sm text-text placeholder:text-muted focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all"
                disabled={isLoading}
              />
              <button
                onClick={handleSendMessage}
                disabled={!inputValue.trim() || isLoading}
                className="p-3 bg-primary hover:bg-primary/80 text-white rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:shadow-glow"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-muted mt-2 text-center">
              Say "human" to connect with live support
            </p>
          </div>
        </div>
      )}

      {/* Mr. Imagine Chat Button */}
      <button
        onClick={handleToggleChat}
        className={`relative group transition-all duration-300 ${
          isOpen ? 'scale-90' : 'scale-100 hover:scale-110'
        }`}
      >
        {/* Notification badge */}
        {hasNewMessage && !isOpen && (
          <div className="absolute -top-1 -right-1 z-20">
            <span className="relative flex h-5 w-5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75"></span>
              <span className="relative inline-flex rounded-full h-5 w-5 bg-accent items-center justify-center text-xs font-bold text-white">
                !
              </span>
            </span>
          </div>
        )}

        {/* Glow effect */}
        <div className="absolute inset-0 bg-primary/40 blur-xl rounded-full group-hover:bg-primary/60 transition-all" />

        {/* Avatar container */}
        <div className="relative w-16 h-16 bg-gradient-to-br from-primary to-secondary rounded-full p-0.5 shadow-lg group-hover:shadow-glow transition-shadow">
          <div className="w-full h-full bg-card rounded-full flex items-center justify-center overflow-hidden">
            <MrImagineAvatar
              size="md"
              pose="head"
              expression={isOpen ? 'default' : 'waving'}
              animate={!isOpen}
              glow={false}
              className="transform scale-110"
            />
          </div>
        </div>

        {/* Tooltip */}
        {!isOpen && (
          <div className="absolute bottom-full mb-2 right-0 px-3 py-1.5 bg-card border border-primary/20 rounded-lg text-sm text-text whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
            Chat with {MR_IMAGINE_CONFIG.name}!
          </div>
        )}
      </button>
    </div>
  )
}
