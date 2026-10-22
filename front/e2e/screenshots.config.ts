import { defineConfig } from '@playwright/test';

/** Base URL of a running front (compose default: http://localhost:8401). */
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:8401';

/** 1440p viewport. */
const VIEWPORT = { width: 2560, height: 1440 };

/** Screenshot capture of every page, light and dark (read-only, see screenshots/capture.spec.ts). */
export default defineConfig({
  testDir: './screenshots',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: 2,
  reporter: [['list']],
  outputDir: 'test-results/screenshots',
  use: {
    baseURL: BASE_URL,
    actionTimeout: 15_000,
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    // Full Chromium (new headless) ships the PDF viewer; the headless shell renders PDFs blank.
    channel: 'chromium',
    launchOptions: {
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    },
  },
  projects: [
    { name: 'light', use: { colorScheme: 'light' } },
    { name: 'dark', use: { colorScheme: 'dark' } },
  ],
});
