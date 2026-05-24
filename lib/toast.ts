export type ToastType = 'success' | 'error' | 'info' | 'warning' | 'loading'
export type ToastPosition = 'top-right' | 'bottom-center'

export interface ToastItem {
  id: string
  message: string
  type: ToastType
  duration: number
  position: ToastPosition
}

export interface ToastOptions {
  id?: string
  duration?: number
  position?: ToastPosition
}

type AddListener = (item: ToastItem) => void
type DismissListener = (id: string) => void

const addListeners: AddListener[] = []
const dismissListeners: DismissListener[] = []

const DEFAULT_DURATIONS: Record<ToastType, number> = {
  success: 3000,
  error: 4500,
  info: 3000,
  warning: 3500,
  loading: Infinity,
}

function emit(message: string, type: ToastType, opts: ToastOptions): string {
  const id = opts.id ?? Math.random().toString(36).slice(2, 9)
  const item: ToastItem = {
    id,
    message,
    type,
    duration: opts.duration ?? DEFAULT_DURATIONS[type],
    position: opts.position ?? 'top-right',
  }
  addListeners.forEach((l) => l(item))
  return id
}

// Legacy second-arg shape: every existing caller in the repo passes either
// nothing or a bare number (the old `duration` param). Keep that working by
// normalizing here so callers don't all need updating for P7.1.
function normalize(durationOrOpts?: number | ToastOptions): ToastOptions {
  if (typeof durationOrOpts === 'number') return { duration: durationOrOpts }
  return durationOrOpts ?? {}
}

export const toast = {
  success: (message: string, durationOrOpts?: number | ToastOptions) =>
    emit(message, 'success', normalize(durationOrOpts)),
  error: (message: string, durationOrOpts?: number | ToastOptions) =>
    emit(message, 'error', normalize(durationOrOpts)),
  info: (message: string, durationOrOpts?: number | ToastOptions) =>
    emit(message, 'info', normalize(durationOrOpts)),
  warning: (message: string, durationOrOpts?: number | ToastOptions) =>
    emit(message, 'warning', normalize(durationOrOpts)),
  loading: (message: string, opts?: ToastOptions) =>
    emit(message, 'loading', opts ?? {}),
  dismiss: (id: string) => {
    dismissListeners.forEach((l) => l(id))
  },
}

export function subscribeToToasts(listener: AddListener): () => void {
  addListeners.push(listener)
  return () => {
    const i = addListeners.indexOf(listener)
    if (i !== -1) addListeners.splice(i, 1)
  }
}

export function subscribeToToastDismiss(listener: DismissListener): () => void {
  dismissListeners.push(listener)
  return () => {
    const i = dismissListeners.indexOf(listener)
    if (i !== -1) dismissListeners.splice(i, 1)
  }
}
