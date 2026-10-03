import { expect, test } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { ALL_FORMATS, BufferSource, Input } from 'mediabunny'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'

/** Minimal valid PNG (solid colour) so the test needs no fixtures. */
function solidPng(w: number, h: number, rgb: [number, number, number]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf: Buffer) => {
    let c = 0xffffffff
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0)])
  for (let x = 0; x < w; x++) row.set(rgb, 1 + x * 3)
  const raw = Buffer.concat(Array.from({ length: h }, (_, y) => {
    const r = Buffer.from(row)
    // A white band in the top third: something for Screen Focus to aim at.
    if (y > h * 0.2 && y < h * 0.3) for (let x = 0; x < w; x++) r.set([255, 255, 255], 1 + x * 3)
    return r
  }))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

const parse = (r: any) => JSON.parse(r.content.find((c: any) => c.type === 'text').text)

test('an agent can build and export a video through MCP', async ({}, info) => {
  test.setTimeout(240_000)
  const home = mkdtempSync(join(tmpdir(), 'unicali-mcp-'))
  const screenshot = join(home, 'app.png')
  writeFileSync(screenshot, solidPng(390, 844, [124, 92, 255]))

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['bin/unicali.mjs', 'mcp'],
    env: { ...(process.env as Record<string, string>), UNICALI_HOME: home, UNICALI_PORT: '5321' },
    stderr: 'pipe',
  })
  const client = new Client({ name: 'e2e-agent', version: '1.0.0' })
  await client.connect(transport)
  try {
    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name)
    for (const n of ['create_project', 'import_media', 'add_motion', 'set_camera_path', 'render_frames', 'export_video', 'batch', 'undo']) {
      expect(names).toContain(n)
    }

    const created = parse(await client.callTool({ name: 'create_project', arguments: { name: 'Agent promo', template: 'app-launch' } }))
    expect(created.projectId).toBeTruthy()

    const imported = parse(await client.callTool({ name: 'import_media', arguments: { path: screenshot } }))
    expect(imported.asset.width).toBe(390)

    const path = parse(await client.callTool({
      name: 'set_camera_path',
      arguments: { waypoints: [{ time: 0, yaw: -25 }, { time: 2, focus: { x: 0.5, y: 0.25, size: 0.4 } }, { time: 4, yaw: 0, distance: 9 }] },
    }))
    expect(path.ok).toBe(true)

    // Validation errors come back as tool errors with a readable message.
    const bad = await client.callTool({ name: 'add_motion', arguments: { preset: 'tilt', params: { angleX: 500 } } })
    expect(bad.isError).toBe(true)

    const undo = parse(await client.callTool({ name: 'undo', arguments: {} }))
    expect(undo.summary.keyframeTracks.length).toBe(0) // camera path undone
    await client.callTool({ name: 'redo', arguments: {} })

    const frames: any = await client.callTool({ name: 'render_frames', arguments: { times: [0.5, 2, 3.5], width: 240 } })
    const image = frames.content.find((c: any) => c.type === 'image')
    expect(image.mimeType).toBe('image/png')
    writeFileSync(info.outputPath('agent-sheet.png'), Buffer.from(image.data, 'base64'))

    const exported = parse(await client.callTool({ name: 'export_video', arguments: { format: 'mp4', scale: 0.25 } }))
    expect(existsSync(exported.path)).toBe(true)
    const input = new Input({ source: new BufferSource(readFileSync(exported.path)), formats: ALL_FORMATS })
    const track = (await input.getPrimaryVideoTrack())!
    expect(track.codec).toBe('avc')
    expect(track.displayWidth).toBe(270)
    expect(Math.abs((await input.computeDuration()) - 6)).toBeLessThan(0.05)
    input.dispose()
  } finally {
    await client.close()
  }
})
