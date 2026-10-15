import { inflateSync } from 'node:zlib'

/**
 * Minimal PNG decoder (8-bit RGB/RGBA, non-interlaced) — enough for device screenshots, so
 * the server can check frames (blank/protected windows, screen stability) without a native
 * image dependency.
 */
export interface Rgba {
  width: number
  height: number
  data: Uint8Array
}

export function decodePng(buf: Buffer): Rgba {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('Not a PNG')
  let off = 8
  let width = 0, height = 0, colorType = 0, bitDepth = 0, interlace = 0
  const idat: Buffer[] = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    off += 12 + len
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`Unsupported PNG (depth ${bitDepth}, colour ${colorType}, interlace ${interlace})`)
  }
  const bpp = colorType === 6 ? 4 : 3
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * bpp
  const out = new Uint8Array(width * height * 4)
  const prev = new Uint8Array(stride)
  const cur = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0
      const b = prev[x]
      const c = x >= bpp ? prev[x - bpp] : 0
      let v = line[x]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      cur[x] = v & 0xff
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      out[o] = cur[x * bpp]
      out[o + 1] = cur[x * bpp + 1]
      out[o + 2] = cur[x * bpp + 2]
      out[o + 3] = bpp === 4 ? cur[x * bpp + 3] : 255
    }
    prev.set(cur)
  }
  return { width, height, data: out }
}

/** Downsamples to a small grid (nearest) for cheap comparisons. */
export function thumbnail(img: Rgba, w = 54): Rgba {
  const h = Math.max(1, Math.round((img.height / img.width) * w))
  const data = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.floor((x / w) * img.width), sy = Math.floor((y / h) * img.height)
      data.set(img.data.subarray((sy * img.width + sx) * 4, (sy * img.width + sx) * 4 + 4), (y * w + x) * 4)
    }
  }
  return { width: w, height: h, data }
}
