/**
 * 基础 UI 组件库（Tailwind v4 + 深色 GIS 主题）。
 * 组件风格统一，供各面板复用。
 */
import { useState, useEffect, type ReactNode, type MouseEvent as ReactMouseEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { X, Loader2, ChevronRight, ChevronDown } from 'lucide-react'
import { clsx } from 'clsx'

export function cn(...parts: (string | false | null | undefined)[]): string {
  return clsx(parts)
}

// ---------------- Button ----------------

type ButtonVariant = 'default' | 'primary' | 'ghost' | 'outline' | 'danger'
type ButtonSize = 'xs' | 'sm' | 'md'

const btnVariants: Record<ButtonVariant, string> = {
  default: 'bg-panel-2 border border-border hover:bg-panel-3 text-text',
  primary: 'bg-accent text-white hover:bg-blue-600 border border-transparent',
  ghost: 'bg-transparent border border-transparent hover:bg-panel-2 text-text-dim hover:text-text',
  outline: 'bg-transparent border border-border-strong hover:border-accent text-text',
  danger: 'bg-transparent border border-transparent text-danger hover:bg-danger/10',
}

const btnSizes: Record<ButtonSize, string> = {
  xs: 'h-6 px-2 text-[11px] gap-1 rounded',
  sm: 'h-7 px-2.5 text-xs gap-1.5 rounded-md',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-md',
}

export function Button({
  variant = 'default',
  size = 'sm',
  icon,
  children,
  className,
  title,
  disabled,
  onClick,
}: {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: ReactNode
  children?: ReactNode
  className?: string
  title?: string
  disabled?: boolean
  onClick?: (e: ReactMouseEvent) => void
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap font-medium transition-colors select-none',
        'disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-accent',
        btnVariants[variant],
        btnSizes[size],
        className,
      )}
    >
      {icon}
      {children}
    </button>
  )
}

export function IconButton({
  title,
  icon,
  active,
  disabled,
  onClick,
  className,
}: {
  title: string
  icon: ReactNode
  active?: boolean
  disabled?: boolean
  onClick?: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors select-none',
        active
          ? 'border-accent bg-accent-soft text-accent'
          : 'border-transparent text-text-dim hover:bg-panel-2 hover:text-text',
        'disabled:opacity-40 disabled:pointer-events-none',
        className,
      )}
    >
      {icon}
    </button>
  )
}

// ---------------- Panel ----------------

export function Panel({
  title,
  icon,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode
  icon?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <div className={cn('panel flex flex-col min-h-0', className)}>
      {title !== undefined && (
        <div className="panel-header shrink-0">
          {icon}
          <span className="flex-1 truncate">{title}</span>
          {actions && <div className="flex items-center gap-1">{actions}</div>}
        </div>
      )}
      <div className={cn('min-h-0 flex-1 overflow-auto', bodyClassName)}>{children}</div>
    </div>
  )
}

export function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('mt-3 mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-faint', className)}>
      {children}
    </div>
  )
}

// ---------------- 表单控件 ----------------

export function Field({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn('flex flex-col gap-1', className)}>
      <span className="text-[11px] text-text-dim">{label}</span>
      {children}
    </label>
  )
}

export function TextInput({
  value,
  onChange,
  placeholder,
  className,
  onKeyDown,
  autoFocus,
}: {
  value: string
  onChange?: (v: string) => void
  placeholder?: string
  className?: string
  onKeyDown?: (e: ReactKeyboardEvent) => void
  autoFocus?: boolean
}) {
  return (
    <input
      type="text"
      value={value}
      autoFocus={autoFocus}
      placeholder={placeholder}
      onChange={(e) => onChange?.(e.target.value)}
      onKeyDown={onKeyDown}
      className={cn(
        'h-7 rounded-md border border-border bg-panel-2 px-2 text-xs text-text placeholder:text-text-faint',
        'focus:border-accent focus:outline-none',
        className,
      )}
    />
  )
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  className,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  className?: string
}) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? value : ''}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const v = parseFloat(e.target.value)
        onChange(Number.isFinite(v) ? v : NaN)
      }}
      className={cn(
        'h-7 rounded-md border border-border bg-panel-2 px-2 text-xs text-text focus:border-accent focus:outline-none',
        className,
      )}
    />
  )
}

export function Select({
  value,
  onChange,
  options,
  className,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  className?: string
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'h-7 rounded-md border border-border bg-panel-2 px-1.5 text-xs text-text focus:border-accent focus:outline-none',
        className,
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: ReactNode
}) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-[var(--color-accent)]"
      />
      {label && <span className="text-xs text-text">{label}</span>}
    </label>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={(e) => {
          e.preventDefault()
          onChange(!checked)
        }}
        className={cn(
          'relative h-4 w-7 rounded-full transition-colors',
          checked ? 'bg-accent' : 'bg-panel-3 border border-border-strong',
        )}
      >
        <span
          className={cn(
            'absolute top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-white transition-all',
            checked ? 'left-3.5' : 'left-0.5',
          )}
        />
      </button>
      {label && <span className="text-xs text-text">{label}</span>}
    </label>
  )
}

export function ColorInput({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <input type="color" value={normalizeHex(value)} onChange={(e) => onChange(e.target.value)} />
      <TextInput value={value} onChange={onChange} className="flex-1 font-mono text-[11px]" />
    </div>
  )
}

function normalizeHex(color: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color
  if (/^#[0-9a-fA-F]{3}$/.test(color)) {
    return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
  }
  return '#e6194b'
}

export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  label,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  label?: ReactNode
}) {
  return (
    <div className="flex items-center gap-2">
      {label && <span className="w-12 shrink-0 text-[11px] text-text-dim">{label}</span>}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1"
      />
      <span className="w-9 shrink-0 text-right font-mono text-[11px] text-text-dim">
        {Number.isFinite(value) ? value.toFixed(step < 1 ? 2 : 0) : '—'}
      </span>
    </div>
  )
}

// ---------------- 其他 ----------------

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('animate-spin', className)} size={14} />
}

export function EmptyState({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      {icon && <div className="text-text-faint">{icon}</div>}
      <div className="text-sm text-text-dim">{title}</div>
      {hint && <div className="text-xs text-text-faint leading-relaxed">{hint}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function CollapseSection({
  title,
  defaultOpen = true,
  children,
  actions,
}: {
  title: ReactNode
  defaultOpen?: boolean
  children: ReactNode
  actions?: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-border/60">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1 px-2 py-1.5 text-left hover:bg-panel-2"
      >
        {open ? <ChevronDown size={13} className="text-text-faint" /> : <ChevronRight size={13} className="text-text-faint" />}
        <span className="flex-1 truncate text-xs font-medium text-text">{title}</span>
        {actions && <span onClick={(e) => e.stopPropagation()}>{actions}</span>}
      </button>
      {open && <div className="px-2 pb-2">{children}</div>}
    </div>
  )
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 480,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onMouseDown={onClose}>
      <div
        className="panel max-h-[80vh] w-full overflow-hidden shadow-2xl"
        style={{ maxWidth: width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="panel-header">
          <span className="flex-1 text-sm font-semibold text-text">{title}</span>
          <button onClick={onClose} className="rounded p-0.5 text-text-dim hover:bg-panel-3 hover:text-text">
            <X size={15} />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-auto p-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-border px-4 py-3">{footer}</div>}
      </div>
    </div>
  )
}
