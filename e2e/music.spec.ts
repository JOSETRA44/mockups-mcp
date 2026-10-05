import { expect, test } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { ALL_FORMATS, BufferSource, Input } from 'mediabunny'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeSong } from './fixtures/song'

async function probe(path: string) {
  const input = new Input({ source: new BufferSource(readFileSync(path)), formats: ALL_FORMATS })
  const audio = await input.getPrimaryAudioTrack()
  const video = await input.getPrimaryVideoTrack()
  const out = { audioCodec: audio?.codec ?? null, videoCodec: video?.codec ?? null, duration: await input.computeDuration() }
  input.dispose()
  return out
}

test('human: add a song, build a story, fit it to the music, export with sound', async ({ page }, info) => {
  test.setTimeout(180_000)
  const dir = mkdtempSync(join(tmpdir(), 'unicali-music-'))
  const song = join(dir, 'song.wav')
  writeSong(song)

  await page.goto('/')
  await page.evaluate(() => indexedDB.deleteDatabase('unicali-mockups'))
  await page.reload()
  await page.getByTestId('music-input').setInputFiles(song)
  await expect(page.getByTestId('music-lane')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/12\d BPM|119 BPM/)).toBeVisible()

  await page.getByTestId('create-storyboard').click()
  await expect(page.getByTestId('shot-focus')).toHaveCount(3)
  await page.getByTestId('fit-to-music').click()
  await expect(page.getByText('Story fitted to the music')).toBeVisible()
  await page.waitForTimeout(800)
  await page.screenshot({ path: info.outputPath('editor-music.png') })

  await page.getByTestId('open-export').click()
  const dialog = page.getByRole('dialog')
  await dialog.locator('select').nth(1).selectOption('0.5')
  const download = page.waitForEvent('download', { timeout: 150_000 })
  await dialog.getByRole('button', { name: 'Export', exact: true }).click()
  const out = info.outputPath('with-music.mp4')
  await (await download).saveAs(out)
  const meta = await probe(out)
  expect(meta.videoCodec).toBe('avc')
  expect(meta.audioCodec).toBe('aac')
})

test('agent: song + storyboard + fit to music through MCP', async ({}, info) => {
  test.setTimeout(240_000)
  const home = mkdtempSync(join(tmpdir(), 'unicali-mcp-music-'))
  const song = join(home, 'song.wav')
  writeSong(song)
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['bin/unicali.mjs', 'mcp'],
    env: { ...(process.env as Record<string, string>), UNICALI_HOME: home, UNICALI_PORT: '5341' },
    stderr: 'pipe',
  })
  const client = new Client({ name: 'e2e-music-agent', version: '1.0.0' })
  await client.connect(transport)
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r: any = await client.callTool({ name, arguments: args })
    const txt = r.content.find((c: any) => c.type === 'text')?.text
    if (r.isError) throw new Error(txt)
    return { json: (() => { try { return JSON.parse(txt) } catch { return txt } })(), raw: r }
  }
  try {
    await call('create_project', { name: 'Music agent' })
    const imported = (await call('import_media', { path: song })).json
    expect(imported.music.bpm).toBeGreaterThan(117)
    expect(imported.music.bpm).toBeLessThan(123)
    expect(imported.music.sections.length).toBeGreaterThan(1)

    await call('create_storyboard', { focusCount: 2 })
    const fitted = (await call('fit_to_music')).json
    expect(fitted.ok).toBe(true)
    const shots = fitted.project.shots as { start: number }[]
    const bars = fitted.project.music.barsInVideo as number[]
    for (const s of shots) expect(bars.some((b) => Math.abs(b - s.start) < 0.03) || s.start === 0).toBe(true)

    await call('set_music', { accents: 'subtle' })
    const frames = (await call('render_frames')).raw
    const img = frames.content.find((c: any) => c.type === 'image')
    writeFileSync(info.outputPath('agent-music-sheet.png'), Buffer.from(img.data, 'base64'))

    const exported = (await call('export_video', { format: 'mp4', scale: 0.25 })).json
    const meta = await probe(exported.path)
    expect(meta.audioCodec).toBe('aac')
  } finally {
    await client.close()
  }
})
