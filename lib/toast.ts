export type ToastType = 'success' | 'error' | 'info' | 'warning'

export interface ToastItem {
  id: string
  message: string
  type: ToastType
  duration: number
}

type Listener = (item: ToastItem) => void

const listeners: Listener[] = []

function emit(message: string, type: ToastType, duration: number) {
  const id = Math.random().toString(36).slice(2, 9)
  const item: ToastItem = { id, message, type, duration }
  listeners.forEach((l) => l(item))
}

export const toast = {
  success: (message: string, duration = 3000) => emit(message, 'success', duration),
  error: (message: string, duration = 4500) => emit(message, 'error', duration),
  info: (message: string, duration = 3000) => emit(message, 'info', duration),
  warning: (message: string, duration = 3500) => emit(message, 'warning', duration),
}

export function subscribeToToasts(listener: Listener): () => void {
  listeners.push(listener)
  return () => {
    const i = listeners.indexOf(listener)
    if (i !== -1) listeners.splice(i, 1)
  }
}
