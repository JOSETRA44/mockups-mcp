import { expect, test, type Page } from '@playwright/test'
import { unzipSync } from 'fflate'
import { ALL_FORMATS, BufferSource, EncodedPacketSink, Input } from 'mediabunny'
import { readFileSync } from 'node:fs'

async function exportWith(page: Page, format: string, motionBlur: string, out: string) {
  await page.getByTestId('open-export').click()
  const dialog = page.getByRole('dialog')
  const selects = dialog.locator('select')
  await selects.nth(0).selectOption(format)
  await selects.nth(1).selectOption('0.5')
  // Motion blur is the last select in the dialog.
  await selects.last().selectOption(motionBlur)
  const download = page.waitForEvent('download', { timeout: 150_000 })
  await dialog.getByRole('button', { name: 'Export', exact: true }).click()
  await (await download).saveAs(out)
  await dialog.getByRole('button', { name: 'Close' }).click()
}

test('transparent background: WebM keeps alpha, PNG sequence has every frame', async ({ page }, info) => {
  await page.goto('/')
  await page.evaluate(() => indexedDB.deleteDatabase('unicali-mockups'))
  await page.reload()
  await page.getByRole('button', { name: 'Transparent' }).click()
  await page.getByRole('combobox').nth(0).selectOption('1:1') // shorter test: square format
  // 2-second scene keeps the PNG export quick.
  await page.locator('input[type=number]').first().fill('2')

  const webm = info.outputPath('alpha.webm')
  await exportWith(page, 'webm', '4', webm)
  const input = new Input({ source: new BufferSource(readFileSync(webm)), formats: ALL_FORMATS })
  const track = (await input.getPrimaryVideoTrack())!
  expect(await track.canBeTransparent()).toBe(true)
  const first = await new EncodedPacketSink(track).getFirstPacket()
  expect(first?.sideData.alpha?.byteLength ?? 0).toBeGreaterThan(0)
  input.dispose()

  const zip = info.outputPath('frames.zip')
  await exportWith(page, 'png', '1', zip)
  const files = Object.keys(unzipSync(readFileSync(zip)))
  expect(files.length).toBe(60) // 2 s × 30 fps
  expect(files[0]).toBe('frame_0000.png')
})
