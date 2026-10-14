import { expect, openApp, test } from './fixtures.js';

test.describe('assistant and settings (read-only)', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
  });

  test('assistant lists conversations and opens one', async ({ page }) => {
    await page.goto('/assistant');
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible();
    const sessions = page.locator('nav[aria-label="Conversations"] button.session');
    if ((await sessions.count()) > 0) {
      await sessions.first().click();
      await expect(page).toHaveURL(/session=/);
      await expect(page.locator('.message').first()).toBeVisible();
    }
  });

  test('assistant attaches a file from the viewer', async ({ page }) => {
    await page.goto('/assistant?attach=%2Fshared%2F2000-01-01%2Fnotes%2Fexample.md');
    await expect(page.locator('.composer .chip', { hasText: 'example.md' })).toBeVisible();
  });

  test('settings sections render and filter', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'AI routing' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Background jobs' })).toBeVisible();
    await page.getByRole('searchbox', { name: 'Find a setting' }).fill('ollama');
    await expect(page.getByRole('heading', { name: 'Ollama' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Telemetry' })).toHaveCount(0);
  });

  test('API keys are masked', async ({ page }) => {
    await page.goto('/settings');
    const key = page.getByLabel('Mistral API key');
    await expect(key).toHaveAttribute('type', 'password');
  });
});
