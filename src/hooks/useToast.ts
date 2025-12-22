import { useToastContext } from '../context/ToastContext'

export function useToast() {
  const { addToast, removeToast, toasts } = useToastContext()

  return {
    toasts,
    success: (title: string, message?: string, duration?: number) =>
      addToast({ type: 'success', title, message, duration }),
    error: (title: string, message?: string, duration?: number) =>
      addToast({ type: 'error', title, message, duration }),
    info: (title: string, message?: string, duration?: number) =>
      addToast({ type: 'info', title, message, duration }),
    warning: (title: string, message?: string, duration?: number) =>
      addToast({ type: 'warning', title, message, duration }),
    dismiss: removeToast
  }
}
