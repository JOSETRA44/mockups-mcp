import { create } from 'zustand'

/** View preferences (not part of the document, not undoable). */
interface UiState {
  /** Snap timeline edits to the musical grid (or to 0.05 s without music). */
  snap: boolean
  setSnap(v: boolean): void
}

const stored = (() => {
  try { return localStorage.getItem('unicali.snap') !== '0' } catch { return true }
})()

export const useUi = create<UiState>()((set) => ({
  snap: stored,
  setSnap: (snap) => {
    try { localStorage.setItem('unicali.snap', snap ? '1' : '0') } catch { /* private mode */ }
    set({ snap })
  },
}))
