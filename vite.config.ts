/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    rollupOptions: {
      // render.html is the headless render target driven by the Unicali server.
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        render: fileURLToPath(new URL('./render.html', import.meta.url)),
      },
    },
  },
  // Pre-bundle up front so the dev server never reloads the page mid-session.
  optimizeDeps: {
    include: ['three', 'mediabunny', 'zod', 'immer', 'zustand', 'zundo', 'dexie', 'fflate', 'i18next', 'react-i18next', 'lucide-react', 'clsx'],
  },
  server: {
    // `npm run dev` talks to a running `npm run serve` for the agent/live-sync API.
    proxy: { '/api': { target: 'http://127.0.0.1:5299', ws: true } },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
