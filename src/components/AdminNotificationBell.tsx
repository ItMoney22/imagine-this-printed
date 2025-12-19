import { useState, useEffect, useRef } from 'react'
import { Bell, X, Check, AlertTriangle, MessageSquare, User } from 'lucide-react'
import { useAuth } from '../context/SupabaseAuthContext'
import { supabase } from '../lib/supabase'
import type { AdminNotification } from '../types'

const API_BASE = import.meta.env.VITE_API_BASE || ''

interface AdminNotificationBellProps {
  onNotificationClick?: (ticketId: string) => void
}

export default function AdminNotificationBell({ onNotificationClick }: AdminNotificationBellProps) {
  const { user } = useAuth()
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [notifications, setNotifications] = useState<AdminNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Check if user has support access
  const hasAccess = user?.role === 'admin' || user?.role === 'support_agent'

  // Get access token on mount
  useEffect(() => {
    const getToken = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      setAccessToken(session?.access_token || null)
    }
    getToken()

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setAccessToken(session?.access_token || null)
    })

    return () => subscription.unsubscribe()
  }, [])

  // Fetch notifications
  const fetchNotifications = async () => {
    if (!hasAccess || !accessToken) return

    try {
      const response = await fetch(`${API_BASE}/api/admin/support/notifications?limit=20&includeRead=true`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      })

      if (response.ok) {
        const data = await response.json()
        setNotifications(data.notifications || [])
        setUnreadCount(data.unreadCount || 0)
      }
    } catch (error) {
      console.error('Error fetching notifications:', error)
    }
  }

  // Mark notification as read
  const markAsRead = async (notificationId: string) => {
    if (!accessToken) return

    try {
      await fetch(`${API_BASE}/api/admin/support/notifications/${notificationId}/read`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      })

      setNotifications(prev =>
        prev.map(n => n.id === notificationId ? { ...n, is_read: true } : n)
      )
      setUnreadCount(prev => Math.max(0, prev - 1))
    } catch (error) {
      console.error('Error marking notification as read:', error)
    }
  }

  // Mark all as read
  const markAllAsRead = async () => {
    if (!accessToken) return

    try {
      await fetch(`${API_BASE}/api/admin/support/notifications/read-all`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      })

      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
      setUnreadCount(0)
    } catch (error) {
      console.error('Error marking all as read:', error)
    }
  }

  // Poll for new notifications
  useEffect(() => {
    if (!hasAccess) return

    fetchNotifications()

    const interval = setInterval(fetchNotifications, 30000) // Poll every 30 seconds

    return () => clearInterval(interval)
  }, [hasAccess, accessToken])

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  if (!hasAccess) return null

  const getNotificationIcon = (type: AdminNotification['type']) => {
    switch (type) {
      case 'new_ticket':
        return <MessageSquare className="w-4 h-4 text-blue-400" />
      case 'ticket_reply':
        return <MessageSquare className="w-4 h-4 text-green-400" />
      case 'ticket_escalation':
        return <AlertTriangle className="w-4 h-4 text-orange-400" />
      case 'agent_needed':
        return <User className="w-4 h-4 text-red-400" />
      default:
        return <Bell className="w-4 h-4 text-muted" />
    }
  }

  const formatTime = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    return `${diffDays}d ago`
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-muted hover:text-text transition-colors"
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 bg-card border border-primary/20 rounded-xl shadow-lg shadow-primary/10 overflow-hidden z-50">
          {/* Header */}
          <div className="p-3 border-b border-primary/10 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text">Notifications</h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-xs text-primary hover:text-primary/80 transition-colors"
              >
                Mark all as read
              </button>
            )}
          </div>

          {/* Notification List */}
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="p-6 text-center text-muted">
                <Bell className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No notifications yet</p>
              </div>
            ) : (
              notifications.map(notification => (
                <div
                  key={notification.id}
                  className={`p-3 border-b border-primary/5 hover:bg-primary/5 cursor-pointer transition-colors ${
                    !notification.is_read ? 'bg-primary/10' : ''
                  }`}
                  onClick={() => {
                    if (!notification.is_read) {
                      markAsRead(notification.id)
                    }
                    if (notification.ticket_id && onNotificationClick) {
                      onNotificationClick(notification.ticket_id)
                      setIsOpen(false)
                    }
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">
                      {getNotificationIcon(notification.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${!notification.is_read ? 'font-semibold text-text' : 'text-muted'}`}>
                        {notification.title}
                      </p>
                      {notification.message && (
                        <p className="text-xs text-muted mt-0.5 line-clamp-2">
                          {notification.message}
                        </p>
                      )}
                      <p className="text-xs text-muted/60 mt-1">
                        {formatTime(notification.created_at)}
                      </p>
                    </div>
                    {!notification.is_read && (
                      <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-1.5" />
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="p-2 border-t border-primary/10">
              <button
                onClick={() => {
                  setIsOpen(false)
                  // Navigate to support tab
                  window.location.href = '/admin?tab=support'
                }}
                className="w-full text-center text-xs text-primary hover:text-primary/80 py-1 transition-colors"
              >
                View all tickets
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
