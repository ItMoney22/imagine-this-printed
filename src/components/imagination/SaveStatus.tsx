import React from 'react'
import { Check, Loader2, AlertCircle, WifiOff, X } from 'lucide-react'

interface SaveStatusProps {
  status: 'saved' | 'saving' | 'unsaved' | 'offline' | 'error'
  lastSaved?: Date
}

const STATUS_CONFIG: Record<string, {
  icon: typeof Check;
  text: string;
  color: string;
  dotColor: string;
  animate?: boolean;
}> = {
  saved: {
    icon: Check,
    text: 'Saved',
    color: 'text-green-400',
    dotColor: 'bg-green-400',
    animate: false
  },
  saving: {
    icon: Loader2,
    text: 'Saving...',
    color: 'text-blue-400',
    dotColor: 'bg-blue-400',
    animate: true
  },
  unsaved: {
    icon: AlertCircle,
    text: 'Unsaved changes',
    color: 'text-yellow-400',
    dotColor: 'bg-yellow-400',
    animate: false
  },
  offline: {
    icon: WifiOff,
    text: 'Offline',
    color: 'text-gray-400',
    dotColor: 'bg-gray-400',
    animate: false
  },
  error: {
    icon: X,
    text: 'Error saving',
    color: 'text-red-400',
    dotColor: 'bg-red-400',
    animate: false
  }
}

function formatTimeAgo(date: Date): string {
  const now = new Date()
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (seconds < 60) return 'just now'
  if (seconds < 120) return '1 minute ago'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`
  if (seconds < 7200) return '1 hour ago'
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

export default function SaveStatus({ status, lastSaved }: SaveStatusProps) {
  const [timeAgo, setTimeAgo] = React.useState<string>('')
  const config = STATUS_CONFIG[status]
  const Icon = config.icon

  React.useEffect(() => {
    if (lastSaved && status === 'saved') {
      const updateTimeAgo = () => {
        setTimeAgo(formatTimeAgo(lastSaved))
      }

      updateTimeAgo()
      const interval = setInterval(updateTimeAgo, 30000) // Update every 30 seconds

      return () => clearInterval(interval)
    } else {
      setTimeAgo('')
    }
  }, [lastSaved, status])

  return (
    <div className="flex items-center gap-2 mt-2">
      {/* Status Dot */}
      <div className="relative flex items-center justify-center">
        <div className={`w-2 h-2 rounded-full ${config.dotColor}`} />
        {config.animate && (
          <div className={`absolute w-2 h-2 rounded-full ${config.dotColor} animate-ping`} />
        )}
      </div>

      {/* Status Text */}
      <div className="flex items-center gap-1.5">
        <Icon
          className={`w-3.5 h-3.5 ${config.color} ${config.animate ? 'animate-spin' : ''}`}
        />
        <span className={`text-xs ${config.color}`}>
          {config.text}
        </span>
      </div>

      {/* Time Ago */}
      {timeAgo && (
        <>
          <span className="text-xs text-muted">·</span>
          <span className="text-xs text-muted">{timeAgo}</span>
        </>
      )}
    </div>
  )
}
