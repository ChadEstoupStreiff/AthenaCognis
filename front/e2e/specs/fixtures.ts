import { expect, type Page, test as base } from '@playwright/test';

/** Errors collected while a page runs. */
export interface PageErrors {
  readonly messages: string[];
}

/** Backend quirk: a missing stockpile key answers 500 (the SPA treats it as "no value"). */
const EXPECTED_SERVER_ERROR_PATH = '/api/stockpile/get/';

/** Writes are blocked unless `E2E_ALLOW_WRITES=1` (smoke tests run against a live stack with real data). */
const READ_ONLY = process.env.E2E_ALLOW_WRITES !== '1';

/**
 * Abort backend writes and telemetry so smoke tests never change data.
 *
 * @param page - Page.
 */
async function guardWrites(page: Page): Promise<void> {
  await page.route('**/telemetry/**', (route) => route.abort());
  await page.route('**/api/**', (route) =>
    route.request().method() === 'GET' ? route.continue() : route.abort(),
  );
}

/** Test fixture failing on uncaught errors and 5xx responses. */
export const test = base.extend<{ errors: PageErrors }>({
  page: async ({ page }, use) => {
    if (READ_ONLY) {
      await guardWrites(page);
    }
    await use(page);
  },
  errors: [
    async ({ page }, use) => {
      const errors: PageErrors = { messages: [] };
      page.on('pageerror', (error) => errors.messages.push(`pageerror: ${error.message}`));
      page.on('response', (response) => {
        if (response.status() >= 500 && !response.url().includes(EXPECTED_SERVER_ERROR_PATH)) {
          errors.messages.push(`${String(response.status())} ${response.url()}`);
        }
      });
      await use(errors);
      expect(errors.messages, 'page errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/**
 * Open the app and wait for the shell.
 *
 * @param page - Page.
 */
export async function openApp(page: Page): Promise<void> {
  await page.goto('/home');
  await expect(page.getByRole('complementary', { name: 'Main navigation' })).toBeVisible();
}
