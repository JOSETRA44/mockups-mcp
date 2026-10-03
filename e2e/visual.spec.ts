import { test, type Page } from '@playwright/test'

/** Renders a few reference poses for eyeballing the look (not a pass/fail test). */
async function seek(page: Page, seconds: number) {
  await page.keyboard.press('Home')
  for (let i = 0; i < seconds; i++) await page.keyboard.press('Shift+ArrowRight')
  await page.waitForTimeout(400)
}

test('reference poses', async ({ page }, info) => {
  await page.goto('/')
  await page.evaluate(() => indexedDB.deleteDatabase('unicali-mockups'))
  await page.reload()
  const canvas = page.getByTestId('viewport-canvas')
  await seek(page, 3)
  await canvas.screenshot({ path: info.outputPath('pose-front.png') })
  // Rotate the device by dragging to see the side/back.
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 180, box.y + box.height / 2 + 20, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(300)
  await canvas.screenshot({ path: info.outputPath('pose-angle.png') })
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 240, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(300)
  await canvas.screenshot({ path: info.outputPath('pose-back.png') })
})
