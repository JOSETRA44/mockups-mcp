import { useEffect, useState } from 'react'
import { redo, undo, useEditor } from '@/state/editor'
import { usePlayback } from '@/state/playback'
import { useProjectSync } from '@/state/sync'
import { ExportDialog } from '@/ui/ExportDialog'
import { Header } from '@/ui/Header'
import { Inspector } from '@/ui/panels/Inspector'
import { Sidebar } from '@/ui/panels/Sidebar'
import { Timeline } from '@/ui/timeline/Timeline'
import { Toasts } from '@/ui/common/toast'
import { Viewport } from '@/ui/Viewport'

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') return
      const pb = usePlayback.getState()
      const { project, selection, removeClip } = useEditor.getState()
      const frame = 1 / project.settings.fps
      if (e.code === 'Space') {
        e.preventDefault()
        if (!pb.playing && pb.time >= project.settings.duration - 1e-3) pb.setTime(0)
        pb.toggle()
      } else if (e.key === 'Home' || e.key === 'End') {
        pb.pause()
        pb.setTime(e.key === 'Home' ? 0 : project.settings.duration)
      } else if (e.key === 'ArrowLeft') {
        pb.pause()
        pb.setTime(Math.max(0, pb.time - (e.shiftKey ? 1 : frame)))
      } else if (e.key === 'ArrowRight') {
        pb.pause()
        pb.setTime(Math.min(project.settings.duration, pb.time + (e.shiftKey ? 1 : frame)))
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selection.kind === 'clip') {
        removeClip(selection.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export default function App() {
  const [exporting, setExporting] = useState(false)
  useProjectSync()
  useShortcuts()
  return (
    <div className="flex h-full flex-col">
      <Header onExport={() => setExporting(true)} />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          <Viewport />
          <Timeline />
        </main>
        <Inspector />
      </div>
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
      <Toasts />
    </div>
  )
}
