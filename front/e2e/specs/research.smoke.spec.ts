import { expect, openApp, test } from './fixtures.js';

test.describe('research (read-only)', () => {
  test.beforeEach(async ({ page }) => {
    // External sources (OpenAlex, CrossRef…) stay offline in smoke tests.
    await page.route(
      (url) => !['localhost', '127.0.0.1'].includes(url.hostname),
      (route) => route.abort(),
    );
    await openApp(page);
  });

  test('library lists papers or asks for the SOTA tag', async ({ page }) => {
    await page.goto('/research');
    const tabs = page.getByRole('tab', { name: /Library/ });
    await expect(
      tabs.or(page.getByText('Pick the tag marking your state-of-the-art papers')),
    ).toBeVisible();
    if (await tabs.isVisible()) {
      await expect(page.getByText(/validated ·/)).toBeVisible();
      await page.getByRole('button', { name: /Cite/ }).first().click();
      await expect(page.getByRole('dialog', { name: 'Cite' })).toBeVisible();
    } else {
      await expect(
        page.getByText('Pick the tag marking your state-of-the-art papers'),
      ).toBeVisible();
    }
  });

  test('map renders the graph', async ({ page }) => {
    await page.goto('/research?tab=map');
    const graph = page.locator('ac-graph canvas');
    const tab = page.getByRole('tab', { name: /Citation/ });
    await expect(
      tab.or(page.getByText('Pick the tag marking your state-of-the-art papers')),
    ).toBeVisible();
    if (await tab.isVisible()) {
      await expect(graph).toBeVisible({ timeout: 15_000 });
    }
  });
});
