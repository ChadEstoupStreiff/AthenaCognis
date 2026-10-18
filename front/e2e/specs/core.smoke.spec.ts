import { expect, openApp, test } from './fixtures.js';

test.describe('core pages (read-only)', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
  });

  test('home shows today and insights', async ({ page, errors }) => {
    await page.goto('/home');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      /Good (morning|afternoon|evening)/,
    );
    await page.getByRole('tab', { name: 'Insights' }).click();
    await expect(page.getByText('Files', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    expect(errors.messages).toEqual([]);
  });

  test('library streams results and opens the file panel', async ({ page }) => {
    await page.goto('/library?range=all&mode=0');
    await expect(page.getByText(/file\(s\) in/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('searchbox', { name: 'Search text' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Filters/ })).toBeVisible();
    const first = page.locator('.list-row, .card, .table-row').first();
    await first.click();
    const panel = page.locator('.file-peek');
    await expect(panel.getByRole('button', { name: 'Open' })).toBeVisible();
    await expect(panel.getByRole('tab', { name: 'Overview' })).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'Summary' })).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'Projects' })).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'People' })).toBeVisible();
  });

  test('logo goes home and jobs mascot opens the jobs panel', async ({ page }) => {
    await page.goto('/library');
    await page.getByRole('link', { name: /AthenaCognis/ }).click();
    await expect(page).toHaveURL(/\/home/);
    await page.getByRole('button', { name: /background jobs/i }).click();
    await expect(page.getByRole('heading', { name: 'Background jobs' })).toBeVisible();
  });

  test('viewer opens a file from the library', async ({ page }) => {
    await page.goto('/library?range=all&mode=0');
    await expect(page.getByText(/file\(s\) in/)).toBeVisible({ timeout: 30_000 });
    await page.locator('.list-row, .card, .table-row').first().dblclick();
    await expect(page).toHaveURL(/\/f\/\d{4}-\d{2}-\d{2}\//);
    await expect(page.getByRole('tab', { name: 'Info' })).toBeVisible();
    await page.getByRole('tab', { name: 'AI' }).click();
    await expect(page.getByText('Background jobs')).toBeVisible();
  });

  test('notes page lists a day', async ({ page }) => {
    await page.goto('/notes');
    await expect(page.getByText('Pick a note or start a new one')).toBeVisible();
  });

  test('palette and upload dialog open from the keyboard', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByRole('textbox', { name: 'Command palette' })).toBeFocused();
    await page.keyboard.type('Libr');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/library/);
    await expect(page.getByRole('textbox', { name: 'Command palette' })).toBeHidden();
    await page.keyboard.press('u');
    await expect(page.getByText('Drop files here or click to browse')).toBeVisible();
  });
});
