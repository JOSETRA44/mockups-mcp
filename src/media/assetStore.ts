import Dexie, { type Table } from 'dexie'
import type { Project } from '@/core/schema/project'

interface BlobRow {
  id: string
  blob: Blob
}

interface ProjectRow {
  id: string
  name: string
  updatedAt: number
  doc: Project
}

class MockupDB extends Dexie {
  blobs!: Table<BlobRow, string>
  projects!: Table<ProjectRow, string>
  constructor() {
    super('unicali-mockups')
    this.version(1).stores({ blobs: 'id', projects: 'id, updatedAt' })
  }
}

export const db = new MockupDB()

/** In-memory cache so the editor and exporter share Blobs without re-reading IndexedDB. */
const memory = new Map<string, Blob>()

export async function putBlob(id: string, blob: Blob) {
  memory.set(id, blob)
  await db.blobs.put({ id, blob })
}

/** When set, assets are fetched from a Unicali server instead of IndexedDB. */
let remoteBase: string | null = null
export function setRemoteAssetBase(base: string) {
  remoteBase = base
}

export async function getBlob(id: string): Promise<Blob | null> {
  const hit = memory.get(id)
  if (hit) return hit
  if (remoteBase !== null) {
    const res = await fetch(`${remoteBase}/api/assets/${encodeURIComponent(id)}`)
    if (!res.ok) return null
    const blob = await res.blob()
    memory.set(id, blob)
    return blob
  }
  const row = await db.blobs.get(id)
  if (row) memory.set(id, row.blob)
  return row?.blob ?? null
}

export async function saveProject(doc: Project) {
  await db.projects.put({ id: doc.id, name: doc.name, updatedAt: doc.updatedAt, doc })
}

export async function listProjects() {
  return db.projects.orderBy('updatedAt').reverse().toArray()
}

export async function loadProject(id: string) {
  return (await db.projects.get(id))?.doc ?? null
}

export async function deleteProject(id: string) {
  const doc = await loadProject(id)
  await db.projects.delete(id)
  if (doc) await db.blobs.bulkDelete(Object.keys(doc.assets))
}
