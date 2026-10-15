import type { Texture } from 'three'

/**
 * Something that can fill a device screen. Textures follow one convention:
 * flipY = false (row 0 = top), and the screen shader flips, so images, <video>
 * and decoded canvases all behave the same.
 */
export interface ScreenSource {
  readonly texture: Texture
  readonly width: number
  readonly height: number
  /** Make the texture show the frame at `mediaTime` seconds into the media. */
  prepare(mediaTime: number, playing: boolean): void | Promise<void>
  dispose(): void
}

export interface SourceProvider {
  /** Returns null while the asset is still loading. */
  get(assetId: string): ScreenSource | null
  dispose(): void
}

