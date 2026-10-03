import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from 'zustand'
import { Box, ChevronDown, Download, FilePlus2, FolderOpen, Redo2, Trash2, Undo2 } from 'lucide-react'
import { createProject } from '@/core/factory'
import { deleteProject, listProjects, loadProject } from '@/media/assetStore'
import { redo, undo, useEditor } from '@/state/editor'
import { cueProject } from '@/state/playback'
import { Button } from './common/controls'

export function Header({ onExport }: { onExport: () => void }) {
  const { t } = useTranslation()
  const name = useEditor((s) => s.project.name)
  const update = useEditor((s) => s.update)
  const canUndo = useStore(useEditor.temporal, (s) => s.pastStates.length > 0)
  const canRedo = useStore(useEditor.temporal, (s) => s.futureStates.length > 0)

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-ink-700 bg-ink-900 px-3">
      <div className="flex items-center gap-2 pr-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-[#c45cff]">
          <Box size={15} />
        </span>
        <span className="font-semibold tracking-tight">{t('app.name')}</span>
      </div>
      <ProjectMenu />
      <input
        value={name}
        onChange={(e) => update((p) => { p.name = e.target.value })}
        className="h-8 w-56 rounded-md bg-transparent px-2 text-ink-100 outline-none hover:bg-ink-800 focus:bg-ink-800 focus:ring-1 focus:ring-accent"
        aria-label="Project name"
      />
      <div className="flex-1" />
      <Button title={`${t('header.undo')} (Ctrl+Z)`} onClick={undo} disabled={!canUndo} className="w-8 px-0"><Undo2 size={15} /></Button>
      <Button title={`${t('header.redo')} (Ctrl+Shift+Z)`} onClick={redo} disabled={!canRedo} className="w-8 px-0"><Redo2 size={15} /></Button>
      <Button variant="primary" onClick={onExport} data-testid="open-export">
        <Download size={14} /> {t('header.export')}
      </Button>
    </header>
  )
}

function ProjectMenu() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<{ id: string; name: string; updatedAt: number }[]>([])
  const ref = useRef<HTMLDivElement>(null)
  const currentId = useEditor((s) => s.project.id)

  useEffect(() => {
    if (!open) return
    void listProjects().then((rows) => setItems(rows.map(({ id, name, updatedAt }) => ({ id, name, updatedAt }))))
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  const openProject = async (id: string) => {
    const doc = await loadProject(id)
    if (doc) {
      useEditor.getState().setProject(doc)
      cueProject(doc)
      useEditor.temporal.getState().clear()
    }
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <Button onClick={() => setOpen(!open)} className="px-2">
        <FolderOpen size={14} /> {t('header.projects')} <ChevronDown size={13} />
      </Button>
      {open && (
        <div className="absolute left-0 top-9 z-30 w-72 overflow-hidden rounded-lg border border-ink-700 bg-ink-850 shadow-2xl">
          <button
            className="flex w-full items-center gap-2 border-b border-ink-700 px-3 py-2.5 text-left hover:bg-ink-800"
            onClick={() => {
              const doc = createProject(t('app.untitled'))
              useEditor.getState().setProject(doc)
              cueProject(doc)
              useEditor.temporal.getState().clear()
              setOpen(false)
            }}
          >
            <FilePlus2 size={14} className="text-accent" /> {t('header.newProject')}
          </button>
          <div className="max-h-72 overflow-y-auto">
            {items.length === 0 && <p className="px-3 py-3 text-xs text-ink-400">{t('header.noProjects')}</p>}
            {items.map((p) => (
              <div key={p.id} className={`group flex items-center gap-2 px-3 py-2 hover:bg-ink-800 ${p.id === currentId ? 'bg-accent-soft' : ''}`}>
                <button className="min-w-0 flex-1 text-left" onClick={() => void openProject(p.id)}>
                  <div className="truncate">{p.name}</div>
                  <div className="text-[11px] text-ink-400">{new Date(p.updatedAt).toLocaleString()}</div>
                </button>
                {p.id !== currentId && (
                  <button
                    title={t('header.delete')}
                    className="text-ink-400 opacity-0 hover:text-danger group-hover:opacity-100"
                    onClick={async () => {
                      await deleteProject(p.id)
                      setItems((xs) => xs.filter((x) => x.id !== p.id))
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
