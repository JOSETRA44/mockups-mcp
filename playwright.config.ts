import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  use: {
    baseURL: 'http://localhost:5199',
    channel: 'chrome', // real Chrome: GPU WebGL + proprietary H.264 encoder
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  },
  webServer: {
    command: 'npx vite --port 5199 --strictPort',
    url: 'http://localhost:5199',
    reuseExistingServer: true,
  },
})
