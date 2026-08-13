import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 60000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:30233',
    headless: true,
    launchOptions: process.env.PLAYWRIGHT_CHROME_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROME_EXECUTABLE }
      : undefined,
  },
})
