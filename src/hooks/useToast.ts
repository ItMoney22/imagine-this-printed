import { useMemo } from 'react'
import { useToastContext } from '../context/ToastContext'

export function useToast() {
  const { addToast, removeToast, toasts } = useToastContext()

  // Memoize so the returned object keeps a stable identity across renders.
  // Without this it was a fresh literal every render, which poisoned any
  // useCallback/useEffect that listed `toast` (or a callback derived from it)
  // in its deps — e.g. AdminEmail's loadMessages effect re-fired every render,
  // flashing the inbox skeleton and swallowing clicks. addToast/removeToast are
  // stable (useCallback in ToastContext); identity only changes when `toasts` does.
  return useMemo(
    () => ({
      toasts,
      success: (title: string, message?: string, duration?: number) =>
        addToast({ type: 'success', title, message, duration }),
      error: (title: string, message?: string, duration?: number) =>
        addToast({ type: 'error', title, message, duration }),
      info: (title: string, message?: string, duration?: number) =>
        addToast({ type: 'info', title, message, duration }),
      warning: (title: string, message?: string, duration?: number) =>
        addToast({ type: 'warning', title, message, duration }),
      dismiss: removeToast,
    }),
    [toasts, addToast, removeToast]
  )
}
