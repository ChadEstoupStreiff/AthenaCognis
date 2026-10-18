import { expect, openApp, test } from './fixtures.js';

test.describe('organize pages (read-only)', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
  });

  test('time shows the month grid and statistics', async ({ page }) => {
    await page.goto('/time');
    await expect(page.getByRole('heading', { name: 'Time' })).toBeVisible();
    await expect(page.getByText('Week', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Statistics' }).click();
    await expect(page.getByText(/h over \d+ day/)).toBeVisible();
  });

  test('work shows a board or the empty state', async ({ page }) => {
    await page.goto('/work');
    await expect(page.locator('.column, .p-select').first()).toBeVisible();
  });

  test('a task opens on its details, Edit switches to the form', async ({ page }) => {
    await page.goto('/work');
    const card = page.locator('article.card').first();
    await expect(page.locator('.column, ac-empty-state').first()).toBeVisible();
    test.skip((await card.count()) === 0, 'No task on the board');
    await card.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Description' })).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'Title' })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Edit' }).click();
    await expect(dialog.getByRole('textbox', { name: 'Title' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog.getByRole('button', { name: 'Edit' })).toBeVisible();
  });

  test('projects open their hub', async ({ page }) => {
    await page.goto('/projects');
    const first = page.locator('a.card').first();
    await first.click();
    await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible();
    await page.getByRole('tab', { name: /Files/ }).click();
    await expect(
      page.locator('.list-row, .card, .table-row, ac-empty-state').first(),
    ).toBeVisible();
  });

  test('people list opens a contact', async ({ page }) => {
    await page.goto('/people');
    await page.locator('a.entry').first().click();
    await expect(page.getByRole('tab', { name: 'About' })).toBeVisible();
  });

  test('new menu opens the time entry dialog', async ({ page }) => {
    await page.goto('/home');
    await page.getByRole('button', { name: 'New' }).click();
    await page.getByRole('menuitem', { name: 'Time entry' }).click();
    await expect(page.getByText('Log time').last()).toBeVisible();
    await expect(page).toHaveURL(/\/time/);
  });
});
