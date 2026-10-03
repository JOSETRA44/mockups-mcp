import { create } from 'zustand'

interface Toast { id: number; message: string; tone: 'info' | 'error' }

const useToasts = create<{ toasts: Toast[] }>()(() => ({ toasts: [] }))
let next = 1

export function notify(message: string, tone: Toast['tone'] = 'info') {
  const id = next++
  useToasts.setState((s) => ({ toasts: [...s.toasts, { id, message, tone }] }))
  setTimeout(() => useToasts.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 5000)
}

export function Toasts() {
  const toasts = useToasts((s) => s.toasts)
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`rounded-lg border px-4 py-2 shadow-xl ${t.tone === 'error' ? 'border-danger/40 bg-[#2a1219] text-[#ffb3c1]' : 'border-ink-600 bg-ink-800 text-ink-100'}`}
        >
          {t.message}
        </div>
      ))}
    </div>
  )
}
