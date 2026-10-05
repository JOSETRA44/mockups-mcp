import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'
import { uid } from '@/core/factory'
import type { Asset } from '@/core/schema/project'
import { putBlob } from './assetStore'
import { analyzeBlob, visualOf } from './audio'

export const ACCEPTED = 'image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime,audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac'

export const isAudioFile = (f: File) => f.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(f.name)

/** Stores the file and returns asset metadata (dimensions, duration, audio). */
export async function importMedia(file: File): Promise<Asset> {
  const id = `asset-${uid()}`
  if (isAudioFile(file)) {
    // Container probe only (no decode): enrichMedia decodes once for the analysis.
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
    const duration = await input.computeDuration().finally(() => input.dispose())
    await putBlob(id, file)
    return { id, kind: 'audio', name: file.name, mime: file.type || 'audio/mpeg', width: 0, height: 0, duration }
  }
  if (file.type.startsWith('image/')) {
    const bmp = await createImageBitmap(file)
    const asset: Asset = { id, kind: 'image', name: file.name, mime: file.type, width: bmp.width, height: bmp.height }
    bmp.close()
    await putBlob(id, file)
    return asset
  }

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  try {
    const video = await input.getPrimaryVideoTrack()
    if (!video) throw new Error('This file has no video track.')
    if (!(await video.canDecode())) throw new Error('This browser cannot decode this video codec.')
    const audio = await input.getPrimaryAudioTrack()
    const asset: Asset = {
      id,
      kind: 'video',
      name: file.name,
      mime: file.type || 'video/mp4',
      width: video.displayWidth,
      height: video.displayHeight,
      duration: await input.computeDuration(),
      hasAudio: !!audio,
    }
    await putBlob(id, file)
    return asset
  } finally {
    input.dispose()
  }
}

/**
 * Adds what the editor learns by looking at the file: a colour palette for images/videos
 * (for "match media" looks) and the beat/section analysis for songs. Failures are non-fatal.
 */
export async function enrichMedia(file: Blob, asset: Asset): Promise<{ asset: Asset; analysis?: import('@/core/schema/project').MusicAnalysis }> {
  try {
    if (asset.kind === 'audio') return { asset, analysis: (await analyzeBlob(file)).analysis }
    return { asset: { ...asset, ...(await visualOf(file, asset.kind)) } }
  } catch (err) {
    console.warn('[import] analysis failed', err)
    return { asset }
  }
}
