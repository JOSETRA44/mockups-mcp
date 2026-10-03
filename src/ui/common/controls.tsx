import clsx from 'clsx'
import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

export function Section({ title, children, actions, defaultOpen = true }: { title: string; children: ReactNode; actions?: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="border-b border-ink-700/70">
      <header className="flex h-9 items-center gap-2 px-3">
        <button className="flex flex-1 items-center gap-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-300" onClick={() => setOpen(!open)}>
          <ChevronDown size={13} className={clsx('transition-transform', !open && '-rotate-90')} />
          {title}
        </button>
        {actions}
      </header>
      {open && <div className="space-y-2.5 px-3 pb-3">{children}</div>}
    </section>
  )
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid grid-cols-[84px_1fr] items-center gap-2">
      <span className="truncate text-ink-300">{label}</span>
      <div className="min-w-0">{children}</div>
    </label>
  )
}

export function Slider({
  label, value, min, max, step = 0.01, unit, onChange,
}: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void }) {
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2
  return (
    <Row label={label}>
      <div className="flex items-center gap-2">
        <input
          type="range" min={min} max={max} step={step} value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="min-w-0 flex-1"
        />
        <div className="flex w-[64px] items-center rounded-md bg-ink-800 px-1.5 focus-within:ring-1 focus-within:ring-accent">
          <input
            type="number" step={step} value={Number(value.toFixed(decimals))}
            onChange={(e) => e.target.value !== '' && onChange(Number(e.target.value))}
            className="h-6 w-full min-w-0 bg-transparent text-right tabular-nums outline-none"
          />
          {unit && <span className="pl-0.5 text-ink-400">{unit}</span>}
        </div>
      </div>
    </Row>
  )
}

export function Select<T extends string>({
  label, value, options, onChange,
}: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <Row label={label}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="h-7 w-full rounded-md border border-ink-700 bg-ink-800 px-2 outline-none focus:border-accent"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </Row>
  )
}

export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Row label={label}>
      <button
        role="switch" aria-checked={value} onClick={() => onChange(!value)}
        className={clsx('relative h-[18px] w-8 rounded-full transition-colors', value ? 'bg-accent' : 'bg-ink-600')}
      >
        <span className={clsx('absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white transition-all', value ? 'left-[16px]' : 'left-[2px]')} />
      </button>
    </Row>
  )
}

export function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Row label={label}>
      <div className="flex items-center gap-2">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-7 w-9 cursor-pointer" />
        <input
          value={value} onChange={(e) => /^#[0-9a-f]{6}$/i.test(e.target.value) && onChange(e.target.value)}
          className="h-7 w-full min-w-0 rounded-md bg-ink-800 px-2 font-mono text-xs uppercase outline-none focus:ring-1 focus:ring-accent"
        />
      </div>
    </Row>
  )
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-md bg-ink-800 p-0.5">
      {options.map((o) => (
        <button
          key={o.value} onClick={() => onChange(o.value)}
          className={clsx('h-6 flex-1 rounded px-2 text-xs transition-colors', value === o.value ? 'bg-ink-600 text-white' : 'text-ink-300 hover:text-white')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Button({
  children, onClick, variant = 'ghost', className, disabled, title, 'data-testid': testId,
}: { children: ReactNode; onClick?: () => void; variant?: 'primary' | 'ghost' | 'outline' | 'danger'; className?: string; disabled?: boolean; title?: string; 'data-testid'?: string }) {
  return (
    <button
      title={title} disabled={disabled} onClick={onClick} data-testid={testId}
      className={clsx(
        'inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 font-medium transition-colors disabled:pointer-events-none disabled:opacity-40',
        variant === 'primary' && 'bg-accent text-white hover:bg-[#8d72ff]',
        variant === 'ghost' && 'text-ink-300 hover:bg-ink-800 hover:text-white',
        variant === 'outline' && 'border border-ink-700 text-ink-100 hover:bg-ink-800',
        variant === 'danger' && 'text-danger hover:bg-danger/10',
        className,
      )}
    >
      {children}
    </button>
  )
}
