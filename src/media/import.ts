import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'
import { uid } from '@/core/factory'
import type { Asset } from '@/core/schema/project'
import { putBlob } from './assetStore'

export const ACCEPTED = 'image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime'

/** Stores the file and returns asset metadata (dimensions, duration, audio). */
export async function importMedia(file: File): Promise<Asset> {
  const id = `asset-${uid()}`
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
