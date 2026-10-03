import { expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { UnicaliClient } from '../server/client'
import { loadConfig } from '../server/config'
import { startServer, type UnicaliServer } from '../server/http'

let server: UnicaliServer
let api: UnicaliClient

test.beforeAll(async () => {
  server = await startServer(loadConfig({ port: 5331, home: mkdtempSync(join(tmpdir(), 'unicali-live-')), dev: true }))
  api = new UnicaliClient(server.url)
})
test.afterAll(async () => server?.close())

test('editor and agent edit the same project live', async ({ page }) => {
  test.setTimeout(120_000)
  const { project } = await api.createProject('Live test')
  await page.goto(`${server.url}/?project=${project.id}`)
  await expect(page.getByTestId('sync-badge')).toContainText('Live')
  await expect(page.locator('input[aria-label="Project name"]')).toHaveValue('Live test')

  // Agent → editor: a command over the API shows up in the open editor.
  await api.exec(project.id, 'rename_project', { name: 'Renamed by agent' })
  await expect(page.locator('input[aria-label="Project name"]')).toHaveValue('Renamed by agent')
  await api.exec(project.id, 'set_camera_path', { waypoints: [{ time: 0, yaw: -20 }, { time: 2, yaw: 20 }, { time: 4, yaw: 0 }] })
  await expect(page.getByTestId('keyframe-diamond')).toHaveCount(3)

  // Editor → agent: applying a template in the UI is saved to the workspace.
  await page.getByRole('button', { name: 'Motion' }).click()
  await page.getByTestId('template-orbit-showcase').click()
  await expect.poll(async () => (await api.describe(project.id) as any).motions.length, { timeout: 10_000 }).toBe(3)

  // Undo in the agent API restores the previous state in the editor too.
  await api.undo(project.id)
  await expect(page.getByTestId('keyframe-diamond')).toHaveCount(3)
})
