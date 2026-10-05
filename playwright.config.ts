import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  // Every test drives real GPU rendering and headless renderers; more parallelism only adds contention.
  workers: 2,
  use: {
    baseURL: 'http://localhost:5199',
    channel: 'chrome', // real Chrome: GPU WebGL + proprietary H.264 encoder
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  },
  webServer: {
    command: 'npx vite --port 5199 --strictPort',
    url: 'http://localhost:5199',
    // Local-mode tests must never talk to a real Unicali server that happens to be running.
    env: { UNICALI_API: 'off' },
    reuseExistingServer: false,
  },
})
