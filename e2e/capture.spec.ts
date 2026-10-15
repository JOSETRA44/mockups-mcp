import { expect, test } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** A tiny "app": a balance card, a list and a button that changes state. */
const APP = `<!doctype html><html><head><meta name="viewport" content="width=device-width">
<style>body{margin:0;font-family:system-ui;background:#f4f6fb;color:#0b1f3a}
.card{margin:20px;border-radius:20px;padding:24px;background:#4f46e5;color:#fff}
.row{margin:10px 20px;padding:16px;background:#fff;border-radius:14px}
button{margin:20px;width:calc(100% - 40px);padding:18px;border:0;border-radius:16px;background:#0b1f3a;color:#fff;font-size:17px}</style></head>
<body><h1 style="margin:24px 20px 0">Wallet</h1><div class="card"><div>Balance</div><div id="bal" style="font-size:40px;font-weight:800">$1,200</div></div>
${Array.from({ length: 12 }, (_, i) => `<div class="row">Payment ${i + 1}</div>`).join('')}
<button onclick="document.getElementById('bal').textContent='$2,450'">Add money</button></body></html>`

test('an agent captures material from a running app and builds a story with it (web source)', async ({}, info) => {
  test.setTimeout(240_000)
  const home = mkdtempSync(join(tmpdir(), 'unicali-capture-'))
  const page = join(home, 'app.html')
  writeFileSync(page, APP)
  const url = pathToFileURL(page).href

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['bin/unicali.mjs', 'mcp'],
    env: { ...(process.env as Record<string, string>), UNICALI_HOME: home, UNICALI_PORT: '5351' },
    stderr: 'pipe',
  })
  const client = new Client({ name: 'e2e-capture', version: '1.0.0' })
  await client.connect(transport)
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r: any = await client.callTool({ name, arguments: args })
    const texts = r.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
    if (r.isError) throw new Error(texts)
    return { r, texts, image: r.content.find((c: any) => c.type === 'image') }
  }
  try {
    await call('create_project', { name: 'Wallet ad' })
    const opened = await call('capture_open', { kind: 'web', app: url })
    expect(opened.image.mimeType).toBe('image/png')
    expect(opened.texts).toMatch(/heading "Wallet"/)
    expect(opened.texts).not.toMatch(/Add money/) // below the fold: only what is visible is reported

    // Explore: scroll to the button, then a semantic tap changes the state.
    const scrolled = await call('capture_act', { step: { scroll: 'down', amount: 1, speed: 'fling' } })
    expect(scrolled.texts).toMatch(/button\[tap\] "Add money"/)
    await call('capture_act', { step: { tap: { text: 'Add money' } } })
    const after = await call('capture_act', { step: { scroll: 'up', amount: 1, speed: 'fling' } })
    expect(after.texts).toMatch(/\$2,450/)

    // Material: a clean still (UI blocks detected) and a directed take.
    const still = JSON.parse((await call('capture_still', { label: 'Wallet home' })).texts)
    expect(still.asset.kind).toBe('image')
    expect(still.asset.regions.length).toBeGreaterThan(0)
    expect(still.asset.source.kind).toBe('web')

    const take = await call('capture_take', {
      take: { label: 'Add money', steps: [{ scroll: 'down', amount: 0.6, speed: 'slow' }, { tap: { text: 'Add money' } }], leadIn: 400, hold: 600 },
    })
    const takeAsset = JSON.parse(take.texts).asset
    expect(takeAsset.kind).toBe('video')
    expect(takeAsset.trim.out).toBeGreaterThan(takeAsset.trim.in)
    expect(take.image.mimeType).toBe('image/png') // review sheet of the take

    const review = await call('review_material')
    writeFileSync(info.outputPath('material.png'), Buffer.from(review.image.data, 'base64'))

    // Assemble with per-shot media and look at it.
    await call('set_shots', {
      shots: [
        { kind: 'angle', duration: 2, media: { assetId: still.asset.id } },
        { kind: 'focus', duration: 3, region: { x: 0.5, y: 0.5, size: 1.05, w: 1 }, media: { assetId: takeAsset.id, fitTake: true } },
      ],
    })
    const frames = await call('render_frames', { width: 200 })
    writeFileSync(info.outputPath('story.png'), Buffer.from(frames.image.data, 'base64'))
    await call('capture_close')
  } finally {
    await client.close()
  }
})

// Drives a real phone: opt-in only (set UNICALI_TEST_ANDROID=<package>).
test('android capture smoke test (opt-in)', async () => {
  test.skip(!process.env.UNICALI_TEST_ANDROID, 'Set UNICALI_TEST_ANDROID=<package> to run against a connected device')
  const { AndroidSource } = await import('../server/capture/android/source')
  const session = await new AndroidSource().open({ app: process.env.UNICALI_TEST_ANDROID })
  try {
    const look = await session.look()
    expect(look.blank).toBe(false)
    expect(look.tree.elements.length).toBeGreaterThan(0)
  } finally {
    await session.close()
  }
})
