'use client'

import {
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  forwardRef,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useId,
} from 'react'

import { cn } from './utils'

const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background-light'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
}

type ButtonStyleProps = Pick<ButtonProps, 'variant' | 'size'> & { className?: string }

const buttonVariants = {
  primary: 'border-pinspace-ink bg-primary text-pinspace-ink hover:bg-primary-light',
  secondary: 'border-accent bg-accent text-white hover:bg-accent-light',
  ghost: 'border-transparent bg-transparent text-text-primary hover:bg-background-lighter',
  danger: 'border-[rgb(var(--color-danger))] bg-[rgb(var(--color-danger))] text-white hover:bg-[rgb(var(--color-danger)/0.9)]',
}

const buttonSizes = {
  sm: 'min-h-9 px-3 py-1.5 text-sm',
  md: 'min-h-11 px-4 py-2 text-sm',
  lg: 'min-h-12 px-5 py-2.5 text-base',
}

export function buttonStyles({ variant = 'primary', size = 'md', className }: ButtonStyleProps = {}) {
  return cn(
    'inline-flex items-center justify-center gap-2 rounded-pinspace border font-semibold shadow-[0_3px_0_rgb(var(--color-ink))] transition-[transform,background-color,box-shadow] duration-150 active:translate-y-0.5 active:shadow-none disabled:cursor-not-allowed disabled:opacity-55',
    focus,
    buttonVariants[variant],
    buttonSizes[size],
    className,
  )
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', loading = false, disabled, children, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      className={buttonStyles({ variant, size, className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && (
        <span
          aria-hidden="true"
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none"
        />
      )}
      {children}
    </button>
  )
})

type ButtonLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & ButtonStyleProps

export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(function ButtonLink(
  { className, variant = 'primary', size = 'md', ...props },
  ref,
) {
  return <a ref={ref} className={buttonStyles({ variant, size, className })} {...props} />
})

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  size?: 'sm' | 'md' | 'lg'
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, label, size = 'md', type = 'button', ...props },
  ref
) {
  const sizes = { sm: 'h-9 w-9', md: 'h-11 w-11', lg: 'h-12 w-12' }
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-pinspace border border-border bg-background-light text-text-primary transition-colors hover:border-accent hover:bg-background-lighter disabled:cursor-not-allowed disabled:opacity-55',
        focus,
        sizes[size],
        className
      )}
      {...props}
    />
  )
})

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'min-h-11 w-full rounded-pinspace border border-border bg-background-light px-3.5 py-2 text-text-primary placeholder:text-text-dim shadow-sm transition-colors hover:border-text-muted disabled:cursor-not-allowed disabled:bg-background-lighter disabled:text-text-muted aria-[invalid=true]:border-[rgb(var(--color-danger))] aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-[rgb(var(--color-danger))]',
          focus,
          className
        )}
        {...props}
      />
    )
  }
)

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={cn(
          'min-h-11 w-full rounded-pinspace border border-border bg-background-light px-3.5 py-2 text-text-primary shadow-sm transition-colors hover:border-text-muted disabled:cursor-not-allowed disabled:bg-background-lighter disabled:text-text-muted aria-[invalid=true]:border-[rgb(var(--color-danger))]',
          focus,
          className
        )}
        {...props}
      />
    )
  }
)

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          'min-h-28 w-full resize-y rounded-pinspace border border-border bg-background-light px-3.5 py-2 text-text-primary placeholder:text-text-dim shadow-sm transition-colors hover:border-text-muted disabled:cursor-not-allowed disabled:bg-background-lighter disabled:text-text-muted aria-[invalid=true]:border-[rgb(var(--color-danger))] aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-[rgb(var(--color-danger))]',
          focus,
          className,
        )}
        {...props}
      />
    )
  },
)

export const Checkbox = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>>(
  function Checkbox({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        type="checkbox"
        className={cn(
          'h-5 w-5 shrink-0 rounded border-border bg-background-light text-accent accent-[rgb(var(--color-accent))] disabled:cursor-not-allowed disabled:opacity-55',
          focus,
          className,
        )}
        {...props}
      />
    )
  },
)

type SwitchProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> & {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { checked, onCheckedChange, className, disabled, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border border-border transition-colors disabled:cursor-not-allowed disabled:opacity-55',
        checked ? 'bg-accent' : 'bg-background-lighter',
        focus,
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          'h-5 w-5 rounded-full bg-background-light shadow-sm transition-transform',
          checked ? 'translate-x-6' : 'translate-x-1',
        )}
      />
    </button>
  )
})

type FormControlProps = {
  id: string
  'aria-describedby'?: string
  'aria-invalid'?: true
}

type FormFieldProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  id?: string
  label: ReactNode
  description?: ReactNode
  error?: ReactNode
  required?: boolean
  children: (props: FormControlProps) => ReactNode
  labelProps?: Omit<LabelHTMLAttributes<HTMLLabelElement>, 'htmlFor'>
}

export function FormField({
  id,
  label,
  description,
  error,
  required,
  children,
  labelProps,
  className,
  ...props
}: FormFieldProps) {
  const generatedId = useId()
  const controlId = id ?? generatedId
  const descriptionId = description ? `${controlId}-description` : undefined
  const errorId = error ? `${controlId}-error` : undefined
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className={cn('space-y-1.5', className)} {...props}>
      <label {...labelProps} htmlFor={controlId} className={cn('block text-sm font-semibold text-text-primary', labelProps?.className)}>
        {label}
        {required && <span aria-hidden="true" className="ml-1 text-danger">*</span>}
      </label>
      {children({
        id: controlId,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
      })}
      {description && <p id={descriptionId} className="text-sm text-text-secondary">{description}</p>}
      {error && <p id={errorId} role="alert" className="text-sm font-medium text-danger">{error}</p>}
    </div>
  )
}

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function Card(
  { className, ...props },
  ref
) {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-pinspace-lg border border-border bg-background-card p-5 shadow-[var(--shadow-soft)]',
        className
      )}
      {...props}
    />
  )
})

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('space-y-1.5', className)} {...props} />
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-lg font-bold text-text-primary', className)} {...props} />
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm text-text-secondary', className)} {...props} />
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mt-5', className)} {...props} />
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mt-5 border-t border-border pt-4', className)} {...props} />
}

export function DialogActions({ className, 'aria-label': ariaLabel = 'Dialog actions', ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn('flex flex-col-reverse gap-3 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  )
}

type SpinnerProps = HTMLAttributes<HTMLSpanElement> & { label?: string }

export function Spinner({ className, label = 'Loading', ...props }: SpinnerProps) {
  return (
    <span
      role={props['aria-hidden'] ? undefined : 'status'}
      aria-label={props['aria-hidden'] ? undefined : label}
      className={cn(
        'inline-block h-5 w-5 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none',
        className,
      )}
      {...props}
    />
  )
}

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger'
}

export function Badge({ className, variant = 'neutral', ...props }: BadgeProps) {
  const variants = {
    neutral: 'bg-background-lighter text-text-secondary',
    accent: 'bg-primary-muted text-pinspace-ink',
    success: 'bg-[rgb(var(--color-success)/0.12)] text-[rgb(var(--color-success))]',
    warning: 'bg-[rgb(var(--color-warning)/0.12)] text-[rgb(var(--color-warning))]',
    danger: 'bg-[rgb(var(--color-danger)/0.12)] text-[rgb(var(--color-danger))]',
  }
  return (
    <span
      className={cn(
        'inline-flex min-h-6 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
        variants[variant],
        className
      )}
      {...props}
    />
  )
}

type AvatarProps = HTMLAttributes<HTMLSpanElement> & {
  name: string
  src?: string | null
  size?: 'sm' | 'md' | 'lg'
}

export function Avatar({ name, src, size = 'md', className, ...props }: AvatarProps) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '?'
  const sizes = { sm: 'h-8 w-8 text-xs', md: 'h-10 w-10 text-sm', lg: 'h-14 w-14 text-base' }
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent font-bold text-white',
        sizes[size],
        className
      )}
      title={name}
      {...props}
    >
      {src ? (
        // Avatars can be hosted by Supabase, so the native image avoids a brittle host allowlist.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name} className="h-full w-full object-cover" />
      ) : (
        <span aria-hidden="true">{initials}</span>
      )}
      {!src && <span className="sr-only">{name}</span>}
    </span>
  )
}

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'animate-pulse rounded-pinspace bg-background-lighter motion-reduce:animate-none',
        className
      )}
      {...props}
    />
  )
}

type EmptyStateProps = HTMLAttributes<HTMLDivElement> & {
  title: string
  description?: ReactNode
  icon?: ReactNode
  action?: ReactNode
}

export function EmptyState({ title, description, icon, action, className, ...props }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex min-h-52 flex-col items-center justify-center rounded-pinspace-lg border border-dashed border-border bg-background-light p-8 text-center',
        className
      )}
      {...props}
    >
      {icon && <div className="mb-3 text-accent">{icon}</div>}
      <h3 className="text-lg font-bold text-text-primary">{title}</h3>
      {description && <div className="mt-1 max-w-md text-sm text-text-secondary">{description}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

type StatusStateProps = HTMLAttributes<HTMLDivElement> & {
  status: 'loading' | 'success' | 'warning' | 'error' | 'info'
  title: string
  description?: ReactNode
  action?: ReactNode
}

export function StatusState({ status, title, description, action, className, ...props }: StatusStateProps) {
  const isAlert = status === 'error' || status === 'warning'
  return (
    <div
      role={isAlert ? 'alert' : 'status'}
      aria-live={isAlert ? 'assertive' : 'polite'}
      className={cn(
        'rounded-pinspace border border-border bg-background-light p-4',
        status === 'error' && 'border-[rgb(var(--color-danger))] bg-[rgb(var(--color-danger)/0.08)] text-text-primary',
        status === 'warning' && 'border-[rgb(var(--color-warning))] bg-[rgb(var(--color-warning)/0.08)] text-text-primary',
        status === 'success' && 'border-[rgb(var(--color-success))] bg-[rgb(var(--color-success)/0.08)] text-text-primary',
        className
      )}
      {...props}
    >
      <div className="flex items-start gap-3">
        {status === 'loading' && (
          <span
            aria-hidden="true"
            className="mt-0.5 h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-accent border-r-transparent motion-reduce:animate-none"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{title}</p>
          {description && <div className="mt-1 text-sm opacity-80">{description}</div>}
          {action && <div className="mt-3">{action}</div>}
        </div>
      </div>
    </div>
  )
}
