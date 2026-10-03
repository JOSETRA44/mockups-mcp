import { expect, test, type Page } from '@playwright/test'
import { ALL_FORMATS, BufferSource, EncodedPacketSink, Input } from 'mediabunny'
import { readFileSync } from 'node:fs'

/** Draws a fake app screen in the page and returns it as PNG bytes. */
async function fakeAppScreenshot(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 1170
    c.height = 2532
    const g = c.getContext('2d')!
    const grad = g.createLinearGradient(0, 0, 0, c.height)
    grad.addColorStop(0, '#fff7ed')
    grad.addColorStop(1, '#ffe4e6')
    g.fillStyle = grad
    g.fillRect(0, 0, c.width, c.height)
    g.fillStyle = '#111827'
    g.font = 'bold 96px sans-serif'
    g.fillText('Good morning', 80, 300)
    const colors = ['#f97316', '#8b5cf6', '#06b6d4', '#22c55e']
    colors.forEach((col, i) => {
      g.fillStyle = col
      g.beginPath()
      g.roundRect(80, 420 + i * 480, c.width - 160, 400, 48)
      g.fill()
      g.fillStyle = '#ffffff'
      g.font = 'bold 72px sans-serif'
      g.fillText(`Card ${i + 1}`, 140, 560 + i * 480)
    })
    return c.toDataURL('image/png').split(',')[1]
  })
  return Buffer.from(b64, 'base64')
}

async function probe(path: string) {
  const input = new Input({ source: new BufferSource(readFileSync(path)), formats: ALL_FORMATS })
  const track = (await input.getPrimaryVideoTrack())!
  let packets = 0
  for await (const _ of new EncodedPacketSink(track).packets()) packets++
  const result = {
    codec: track.codec,
    width: track.displayWidth,
    height: track.displayHeight,
    duration: await input.computeDuration(),
    packets,
  }
  input.dispose()
  return result
}

async function exportVideo(page: Page, format: 'mp4' | 'webm', out: string) {
  await page.getByTestId('open-export').click()
  const dialog = page.getByRole('dialog')
  await dialog.locator('select').nth(0).selectOption(format)
  await dialog.locator('select').nth(1).selectOption('0.5') // half res keeps the test fast
  const download = page.waitForEvent('download', { timeout: 150_000 })
  await dialog.getByRole('button', { name: 'Export', exact: true }).click()
  await (await download).saveAs(out)
  await expect(dialog.getByTestId('export-done')).toBeVisible()
  await dialog.getByRole('button', { name: 'Close' }).click()
}

test('import, animate, export MP4 and re-import it as a screen video', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.evaluate(() => indexedDB.deleteDatabase('unicali-mockups'))
  await page.reload()
  await expect(page.getByTestId('viewport-canvas')).toBeVisible()

  // Import a screenshot.
  await page.getByTestId('media-input').setInputFiles({ name: 'app.png', mimeType: 'image/png', buffer: await fakeAppScreenshot(page) })
  await expect(page.getByText('On screen')).toBeVisible()
  await page.waitForTimeout(800)
  await page.screenshot({ path: info.outputPath('01-imported.png') })

  // Add a camera move + screen focus and scrub into it.
  await page.getByRole('button', { name: 'Motion' }).click()
  await page.getByRole('button', { name: 'Screen Focus' }).click()
  await expect(page.getByTestId('clip-screen-focus')).toBeVisible()
  await page.keyboard.press('Shift+ArrowRight')
  await page.waitForTimeout(500)
  await page.screenshot({ path: info.outputPath('02-screen-focus.png') })

  // Export MP4 and verify the container.
  const mp4 = info.outputPath('out.mp4')
  await exportVideo(page, 'mp4', mp4)
  const meta = await probe(mp4)
  console.log('mp4', meta)
  expect(meta.width).toBe(540)
  expect(meta.height).toBe(960)
  const duration = await page.evaluate(() => Number(document.querySelector('[data-testid=timeline] .font-mono + .font-mono')?.textContent?.replace(/[^\d.:]/g, '').split(':').reduce((m, s) => Number(m) * 60 + Number(s), 0)))
  expect(meta.packets).toBe(Math.round(duration * 30))
  expect(Math.abs(meta.duration - duration)).toBeLessThan(0.05)

  // Dogfood: the exported MP4 becomes the screen content (frame-exact decode path).
  await page.getByRole('button', { name: 'Media' }).click()
  await page.getByTestId('media-input').setInputFiles(mp4)
  await expect(page.getByText('out.mp4')).toBeVisible()
  await page.waitForTimeout(1000)
  await page.screenshot({ path: info.outputPath('03-video-on-screen.png') })

  const webm = info.outputPath('out.webm')
  await exportVideo(page, 'webm', webm)
  const wmeta = await probe(webm)
  console.log('webm', wmeta)
  expect(wmeta.width).toBe(540)
  expect(wmeta.packets).toBeGreaterThan(0)

  expect(errors).toEqual([])
})
