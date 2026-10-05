import { open } from 'node:fs/promises'
import { extname } from 'node:path'
import { ALL_FORMATS, FilePathSource, Input } from 'mediabunny'

export const MEDIA_TYPES: Record<string, { kind: 'image' | 'video' | 'audio'; mime: string }> = {
  '.png': { kind: 'image', mime: 'image/png' },
  '.jpg': { kind: 'image', mime: 'image/jpeg' },
  '.jpeg': { kind: 'image', mime: 'image/jpeg' },
  '.webp': { kind: 'image', mime: 'image/webp' },
  '.gif': { kind: 'image', mime: 'image/gif' },
  '.mp4': { kind: 'video', mime: 'video/mp4' },
  '.m4v': { kind: 'video', mime: 'video/mp4' },
  '.mov': { kind: 'video', mime: 'video/quicktime' },
  '.webm': { kind: 'video', mime: 'video/webm' },
  '.mp3': { kind: 'audio', mime: 'audio/mpeg' },
  '.wav': { kind: 'audio', mime: 'audio/wav' },
  '.m4a': { kind: 'audio', mime: 'audio/mp4' },
  '.aac': { kind: 'audio', mime: 'audio/aac' },
  '.ogg': { kind: 'audio', mime: 'audio/ogg' },
  '.flac': { kind: 'audio', mime: 'audio/flac' },
}

export interface Probe {
  kind: 'image' | 'video' | 'audio'
  mime: string
  width: number
  height: number
  duration?: number
  hasAudio?: boolean
}

/** Reads dimensions from PNG / JPEG / WebP / GIF headers without decoding pixels. */
function imageSize(b: Buffer): { width: number; height: number } | null {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
  if (b.length > 10 && b.toString('ascii', 0, 3) === 'GIF') return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) }
  if (b.length > 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = b.toString('ascii', 12, 16)
    if (chunk === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) }
    if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff }
    if (chunk === 'VP8L') {
      const bits = b.readUInt32LE(21)
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
    }
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i < b.length - 9) {
      if (b[i] !== 0xff) { i++; continue }
      const marker = b[i + 1]
      const len = b.readUInt16BE(i + 2)
      // SOF0..SOF15 except DHT(C4), JPG(C8), DAC(CC) carry the frame size.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) }
      }
      i += 2 + len
    }
  }
  return null
}

export async function probeFile(path: string): Promise<Probe> {
  const type = MEDIA_TYPES[extname(path).toLowerCase()]
  if (!type) throw new Error(`Unsupported file type "${extname(path)}". Supported: ${Object.keys(MEDIA_TYPES).join(' ')}`)
  if (type.kind === 'image') {
    const fh = await open(path, 'r')
    try {
      const buf = Buffer.alloc(256 * 1024)
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0)
      const size = imageSize(buf.subarray(0, bytesRead))
      if (!size) throw new Error(`Could not read image dimensions of ${path}`)
      return { ...type, ...size }
    } finally {
      await fh.close()
    }
  }
  const input = new Input({ source: new FilePathSource(path), formats: ALL_FORMATS })
  if (type.kind === 'audio') {
    try {
      if (!(await input.getPrimaryAudioTrack())) throw new Error(`${path} has no audio track`)
      return { ...type, width: 0, height: 0, duration: await input.computeDuration() }
    } finally {
      input.dispose()
    }
  }
  try {
    const video = await input.getPrimaryVideoTrack()
    if (!video) throw new Error(`${path} has no video track`)
    return {
      ...type,
      width: video.displayWidth,
      height: video.displayHeight,
      duration: await input.computeDuration(),
      hasAudio: !!(await input.getPrimaryAudioTrack()),
    }
  } finally {
    input.dispose()
  }
}
