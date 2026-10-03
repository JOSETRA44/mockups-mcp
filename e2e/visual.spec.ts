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

test('connected editor with a camera journey', async ({ page }, info) => {
  const { mkdtempSync, copyFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { startServer } = await import('../server/http')
  const { loadConfig } = await import('../server/config')
  const { UnicaliClient } = await import('../server/client')
  const server = await startServer(loadConfig({ port: 5332, home: mkdtempSync(join(tmpdir(), 'unicali-vis-')), dev: true }))
  try {
    const api = new UnicaliClient(server.url)
    const { project } = await api.createProject('Journey', 'camera-journey')
    const shot = join(tmpdir(), 'unicali-vis-shot.png')
    await page.goto(server.url)
    const png = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 390; c.height = 844
      const g = c.getContext('2d')!; g.fillStyle = '#f4f6fb'; g.fillRect(0, 0, 390, 844)
      g.fillStyle = '#4f46e5'; g.beginPath(); g.roundRect(20, 120, 350, 180, 24); g.fill()
      g.fillStyle = '#0b1f3a'; g.beginPath(); g.roundRect(20, 760, 350, 56, 16); g.fill()
      return c.toDataURL('image/png').split(',')[1]
    })
    const { writeFileSync } = await import('node:fs')
    writeFileSync(shot, Buffer.from(png, 'base64'))
    copyFileSync(shot, shot)
    await api.importFile(project.id, shot)
    await page.goto(`${server.url}/?project=${project.id}`)
    await page.getByRole('button', { name: 'Camera', exact: true }).first().click()
    await page.keyboard.press('Home')
    for (let i = 0; i < 2; i++) await page.keyboard.press('Shift+ArrowRight')
    await page.waitForTimeout(800)
    await page.screenshot({ path: info.outputPath('connected-editor.png') })
  } finally {
    await server.close()
  }
})
