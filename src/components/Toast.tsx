import { X, CheckCircle, XCircle, AlertCircle, Info } from 'lucide-react'
import type { Toast as ToastType } from '../context/ToastContext'

interface ToastProps {
  toast: ToastType
  onDismiss: (id: string) => void
}

const icons = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertCircle,
  info: Info
}

const colors = {
  success: {
    border: 'border-l-green-500',
    icon: 'text-green-500',
    bg: 'bg-green-50'
  },
  error: {
    border: 'border-l-red-500',
    icon: 'text-red-500',
    bg: 'bg-red-50'
  },
  warning: {
    border: 'border-l-amber-500',
    icon: 'text-amber-500',
    bg: 'bg-amber-50'
  },
  info: {
    border: 'border-l-blue-500',
    icon: 'text-blue-500',
    bg: 'bg-blue-50'
  }
}

export function Toast({ toast, onDismiss }: ToastProps) {
  const Icon = icons[toast.type]
  const colorScheme = colors[toast.type]

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`
        flex items-start gap-3 p-4
        bg-white dark:bg-gray-800
        rounded-xl shadow-soft-lg
        border-l-4 ${colorScheme.border}
        animate-toast-slide-in
        min-w-[300px] max-w-[400px]
      `}
    >
      <div className={`flex-shrink-0 ${colorScheme.icon}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-text">{toast.title}</p>
        {toast.message && (
          <p className="text-sm text-muted mt-0.5 truncate">{toast.message}</p>
        )}
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        className="flex-shrink-0 p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        aria-label="Dismiss notification"
      >
        <X className="w-4 h-4 text-muted" />
      </button>
    </div>
  )
}
