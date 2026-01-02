import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { X } from 'lucide-react'

// Notification types
type NotificationType = 'info' | 'success' | 'warning' | 'error'

interface Notification {
  id: string
  message: string
  type: NotificationType
  duration?: number
}

interface NotificationContextType {
  notify: (message: string, type?: NotificationType, duration?: number) => void
  success: (message: string, duration?: number) => void
  error: (message: string, duration?: number) => void
  warning: (message: string, duration?: number) => void
  info: (message: string, duration?: number) => void
}

const NotificationContext = createContext<NotificationContextType | null>(null)

// Hook to use notifications
export function useMrImagineNotify() {
  const context = useContext(NotificationContext)
  if (!context) {
    // Fallback to alert if context not available
    return {
      notify: (message: string) => alert(message),
      success: (message: string) => alert(message),
      error: (message: string) => alert(message),
      warning: (message: string) => alert(message),
      info: (message: string) => alert(message),
    }
  }
  return context
}

// Mr. Imagine expressions based on notification type
const getMrImagineImage = (type: NotificationType): string => {
  // Could have different expressions in the future
  // For now, use the waving image for all
  return '/mr-imagine/mr-imagine-waving.png'
}

// Border/accent colors by type
const getTypeStyles = (type: NotificationType) => {
  switch (type) {
    case 'success':
      return {
        border: 'border-emerald-500',
        bg: 'bg-emerald-500/10',
        accent: 'text-emerald-500',
        glow: 'shadow-emerald-500/20'
      }
    case 'error':
      return {
        border: 'border-red-500',
        bg: 'bg-red-500/10',
        accent: 'text-red-500',
        glow: 'shadow-red-500/20'
      }
    case 'warning':
      return {
        border: 'border-amber-500',
        bg: 'bg-amber-500/10',
        accent: 'text-amber-500',
        glow: 'shadow-amber-500/20'
      }
    case 'info':
    default:
      return {
        border: 'border-purple-500',
        bg: 'bg-purple-500/10',
        accent: 'text-purple-500',
        glow: 'shadow-purple-500/20'
      }
  }
}

// Single notification item
function NotificationItem({
  notification,
  onClose
}: {
  notification: Notification
  onClose: (id: string) => void
}) {
  const styles = getTypeStyles(notification.type)
  const [isExiting, setIsExiting] = useState(false)

  const handleClose = useCallback(() => {
    setIsExiting(true)
    setTimeout(() => onClose(notification.id), 300)
  }, [notification.id, onClose])

  useEffect(() => {
    if (notification.duration && notification.duration > 0) {
      const timer = setTimeout(handleClose, notification.duration)
      return () => clearTimeout(timer)
    }
  }, [notification.duration, handleClose])

  return (
    <div
      className={`
        flex items-start gap-3 p-4 rounded-2xl border-2 ${styles.border} ${styles.bg}
        backdrop-blur-xl shadow-xl ${styles.glow}
        transform transition-all duration-300 ease-out
        ${isExiting ? 'opacity-0 translate-x-full' : 'opacity-100 translate-x-0'}
        animate-slideIn
      `}
    >
      {/* Mr. Imagine Avatar */}
      <div className="relative flex-shrink-0">
        <div className={`w-14 h-14 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 p-0.5 shadow-lg ${styles.glow}`}>
          <div className="w-full h-full rounded-full bg-white overflow-hidden">
            <img
              src={getMrImagineImage(notification.type)}
              alt="Mr. Imagine"
              className="w-full h-full object-cover scale-125 translate-y-1"
            />
          </div>
        </div>
        {/* Speech bubble pointer */}
        <div className={`absolute -right-1 top-1/2 -translate-y-1/2 w-3 h-3 ${styles.bg} ${styles.border} border-l-0 border-b-0 rotate-45`} />
      </div>

      {/* Message */}
      <div className="flex-1 min-w-0 pt-1">
        <p className="text-sm font-medium text-text leading-relaxed">
          {notification.message}
        </p>
      </div>

      {/* Close button */}
      <button
        onClick={handleClose}
        className="flex-shrink-0 p-1 rounded-full hover:bg-white/20 transition-colors"
      >
        <X className="w-4 h-4 text-muted" />
      </button>
    </div>
  )
}

// Provider component
export function MrImagineNotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([])

  const addNotification = useCallback((message: string, type: NotificationType = 'info', duration: number = 4000) => {
    const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    setNotifications(prev => [...prev, { id, message, type, duration }])
  }, [])

  const removeNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id))
  }, [])

  const contextValue: NotificationContextType = {
    notify: addNotification,
    success: (message, duration) => addNotification(message, 'success', duration),
    error: (message, duration) => addNotification(message, 'error', duration),
    warning: (message, duration) => addNotification(message, 'warning', duration),
    info: (message, duration) => addNotification(message, 'info', duration),
  }

  return (
    <NotificationContext.Provider value={contextValue}>
      {children}

      {/* Notification container */}
      <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-3 max-w-sm w-full pointer-events-none">
        {notifications.map(notification => (
          <div key={notification.id} className="pointer-events-auto">
            <NotificationItem
              notification={notification}
              onClose={removeNotification}
            />
          </div>
        ))}
      </div>

      {/* Animation styles */}
      <style>{`
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateX(100%);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        .animate-slideIn {
          animation: slideIn 0.3s ease-out forwards;
        }
      `}</style>
    </NotificationContext.Provider>
  )
}

export default MrImagineNotificationProvider
