import { expect, type Locator, type Page, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

/** Repository folder receiving the screenshots. */
const OUTPUT_DIR = path.resolve(import.meta.dirname, '../../../docs/screenshots');

/** Pause letting charts, graphs and transitions settle before a capture. */
const SETTLE_MS = 900;

/** Upper bound when waiting for the network to calm down (streams and polling never fully stop). */
const NETWORK_IDLE_MS = 6_000;

/** Theme storage key of the SPA (see ThemeService). */
const THEME_STORAGE_KEY = 'athena.theme';

/** One sample file per extension shown in the viewer. */
const VIEWER_EXTENSIONS = [
  'pdf',
  'png',
  'jpeg',
  'gif',
  'svg',
  'md',
  'html',
  'sh',
  'docx',
  'xlsx',
  'pptx',
  'mp4',
  'zip',
];

/** File types whose viewer is captured with every inspector tab. */
const INSPECTOR_EXTENSIONS = ['pdf', 'png'];

/** How many months back to look for logged time. */
const TIME_LOOKBACK_MONTHS = 12;

/** Days of the month grid with hours logged. */
const LOGGED_DAY_SELECTOR = 'button.day:not(.outside):not([aria-label$=", 0.0h"])';

/** Search over the whole library, used to pick viewer samples. */
const SEARCH_ALL_URL =
  '/api/files/search/stream?start_date=2000-01-01&end_date=2100-12-31&search_mode=0&engine=contains&similarity_threshold=0.5';

/**
 * Turn a label into a file-name slug.
 *
 * @param label - Free text.
 * @returns Lowercase dash-separated slug.
 */
function slug(label: string): string {
  return label
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Block every write and every call leaving the machine (the stack holds real data).
 *
 * @param page - Page.
 */
async function guardReadOnly(page: Page): Promise<void> {
  await page.route(
    (url) => !['localhost', '127.0.0.1'].includes(url.hostname),
    (route) => route.abort(),
  );
  await page.route('**/telemetry/**', (route) => route.abort());
  await page.route('**/api/**', (route) =>
    route.request().method() === 'GET' ? route.continue() : route.abort(),
  );
}

/**
 * Wait until the page is quiet enough for a capture.
 *
 * @param page - Page.
 */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_MS }).catch(() => undefined);
  await page.waitForTimeout(SETTLE_MS);
}

/**
 * Save a screenshot named `<area>-<scenario>-<theme>.png`.
 *
 * @param page - Page.
 * @param area - Numbered UI area, e.g. `02-library`.
 * @param scenario - What is shown.
 */
async function shot(page: Page, area: string, scenario: string): Promise<void> {
  await settle(page);
  const theme = test.info().project.name;
  await page.screenshot({
    path: path.join(OUTPUT_DIR, `${area}-${slug(scenario)}-${theme}.png`),
    animations: 'disabled',
    caret: 'hide',
  });
}

/**
 * Open a route inside the shell.
 *
 * @param page - Page.
 * @param url - Route.
 */
async function open(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(page.getByRole('complementary', { name: 'Main navigation' })).toBeVisible();
}

/**
 * Capture every visible tab of a tab list, one screenshot each.
 *
 * @param page - Page.
 * @param area - Numbered UI area.
 * @param prefix - Scenario prefix.
 * @param scope - Where to look for tabs.
 */
async function eachTab(page: Page, area: string, prefix: string, scope: Locator): Promise<void> {
  const tabs = scope.getByRole('tab');
  const count = await tabs.count();
  for (let index = 0; index < count; index++) {
    const tab = tabs.nth(index);
    if (!(await tab.isVisible())) {
      continue;
    }
    const label =
      (await tab.innerText()).replace(/\s*\d+\s*$/, '').trim() || `tab-${String(index + 1)}`;
    await tab.click();
    await shot(page, area, `${prefix}-${label}`);
  }
}

/**
 * Click the first match when present.
 *
 * @param locator - Candidates.
 * @returns Whether something was clicked.
 */
async function clickFirst(locator: Locator): Promise<boolean> {
  const first = locator.first();
  if ((await first.count()) === 0 || !(await first.isVisible())) {
    return false;
  }
  await first.click();
  return true;
}

/**
 * List every library file, most recent first.
 *
 * @param page - Page (used for its request context).
 * @returns Shared paths.
 */
async function libraryPaths(page: Page): Promise<string[]> {
  const response = await page.request.get(SEARCH_ALL_URL, { timeout: 120_000 });
  const paths = (await response.text())
    .split('\n')
    .map((line) => /"type":\s*"result",\s*"path":\s*"(\/shared\/[^"]+)"/.exec(line)?.[1])
    .filter((value): value is string => value !== undefined);
  return paths.sort((left, right) => right.localeCompare(left));
}

/**
 * Pick one library file per extension.
 *
 * @param page - Page (used for its request context).
 * @returns Shared paths keyed by extension.
 */
async function viewerSamples(page: Page): Promise<Map<string, string>> {
  const samples = new Map<string, string>();
  for (const sharedPath of await libraryPaths(page)) {
    const extension = sharedPath.split('.').pop()?.toLowerCase();
    if (extension && VIEWER_EXTENSIONS.includes(extension) && !samples.has(extension)) {
      samples.set(extension, sharedPath);
    }
  }
  return samples;
}

/**
 * Pick the longest note of the library (the best showcase of the editor).
 *
 * @param page - Page (used for its request context).
 * @returns Shared path of the note, or undefined when there is none.
 */
async function richestNote(page: Page): Promise<string | undefined> {
  const notes = (await libraryPaths(page)).filter((sharedPath) =>
    /^\/shared\/[\d-]+\/notes\/.+\.md$/.test(sharedPath),
  );
  let best: { path: string; length: number } | undefined;
  for (const note of notes) {
    const response = await page.request.get(note.replace(/^\/shared\//, '/raw/'));
    const length = (await response.text()).length;
    if (!best || length > best.length) {
      best = { path: note, length };
    }
  }
  return best?.path;
}

/**
 * Find the card announcing the most files (`N files`), the richest showcase.
 *
 * @param cards - Candidate cards.
 * @returns The busiest card, or undefined when there is none.
 */
async function busiestCard(cards: Locator): Promise<Locator | undefined> {
  const texts = await cards.allInnerTexts();
  const counts = texts.map((text) => Number(/(\d+)\s+files?/.exec(text)?.[1] ?? 0));
  const best = counts.indexOf(Math.max(...counts));
  return best < 0 ? undefined : cards.nth(best);
}

/**
 * Format a month key `YYYY-MM`, counting back from now.
 *
 * @param monthsAgo - Months before the current one.
 * @returns Month key.
 */
function monthKeyAgo(monthsAgo: number): string {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1);
  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Build the viewer route of a shared path.
 *
 * @param sharedPath - `/shared/<date>/<folder>/<name>`.
 * @returns Viewer URL.
 */
function viewerUrl(sharedPath: string): string {
  const [, , date = '', folder = '', ...name] = sharedPath.split('/');
  return `/f/${date}/${folder}/${encodeURIComponent(name.join('/'))}`;
}

test.beforeAll(() => {
  mkdirSync(OUTPUT_DIR, { recursive: true });
});

test.beforeEach(async ({ page }) => {
  const theme = test.info().project.name;
  await page.addInitScript(
    ([key, value]) => {
      localStorage.setItem(key, value);
    },
    [THEME_STORAGE_KEY, theme],
  );
  await guardReadOnly(page);
});

test('01 home and global overlays', async ({ page }) => {
  const area = '01-home';
  await open(page, '/home');
  await shot(page, area, 'today');
  await page.getByRole('tab', { name: 'Insights' }).click();
  await expect(page.getByText('Files', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await shot(page, area, 'insights');

  await page.getByRole('button', { name: 'New' }).click();
  await shot(page, '00-global', 'new-menu-open');
  await page.keyboard.press('Escape');

  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByRole('textbox', { name: 'Command palette' })).toBeFocused();
  await shot(page, '00-global', 'command-palette-empty');
  await page.keyboard.type('lib');
  await shot(page, '00-global', 'command-palette-filtered');
  await page.keyboard.press('Escape');

  await page.goto('/upload');
  await expect(page.getByText('Drop files here or click to browse')).toBeVisible();
  await shot(page, '00-global', 'upload-dialog');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /background jobs/i }).click();
  await expect(page.getByRole('heading', { name: 'Background jobs' })).toBeVisible();
  await shot(page, '00-global', 'jobs-panel');
});

test('02 library', async ({ page }) => {
  const area = '02-library';
  await open(page, '/library?range=all&mode=0');
  await expect(page.getByText(/file\(s\) in/)).toBeVisible({ timeout: 60_000 });
  for (const view of ['Cards', 'List', 'Table']) {
    await page.locator(`.p-selectbutton [aria-label="${view}"]`).first().click();
    await shot(page, area, `all-files-${view}-view`);
  }
  await page.locator('.p-selectbutton [aria-label="Cards"]').first().click();

  await page.getByRole('button', { name: /Filters/ }).click();
  await shot(page, area, 'filters-collapsed');
  await page.getByRole('button', { name: /Filters/ }).click();

  await page.locator('.list-row, .card, .table-row').first().click();
  await expect(page.locator('.file-peek').getByRole('button', { name: 'Open' })).toBeVisible();
  await shot(page, area, 'file-side-panel-overview');
  await eachTab(page, area, 'file-side-panel', page.locator('.file-peek'));
  await page.keyboard.press('Escape');

  await page.getByRole('searchbox', { name: 'Search text' }).fill('athena');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/file\(s\) in/)).toBeVisible({ timeout: 60_000 });
  await shot(page, area, 'text-search-results');

  await page.getByRole('searchbox', { name: 'Search text' }).fill('zzqxjv-no-such-file');
  await page.keyboard.press('Enter');
  await shot(page, area, 'search-no-results');
});

test('03 viewer by file type', async ({ page }) => {
  test.setTimeout(600_000);
  const area = '03-viewer';
  const samples = await viewerSamples(page);
  for (const [extension, sharedPath] of samples) {
    await open(page, viewerUrl(sharedPath));
    await expect(page.getByRole('tab', { name: 'Info' })).toBeVisible({ timeout: 30_000 });
    await shot(page, area, `${extension}-file-info`);
    if (INSPECTOR_EXTENSIONS.includes(extension)) {
      await eachTab(page, area, `${extension}-file-inspector`, page.locator('main'));
    }
  }
});

test('04 notes', async ({ page }) => {
  const area = '04-notes';
  await open(page, '/notes');
  await shot(page, area, 'day-list');
  const note = await richestNote(page);
  if (note) {
    const date = note.split('/')[2] ?? '';
    await open(page, `/notes?date=${date}&path=${encodeURIComponent(note)}`);
    await shot(page, area, 'note-open-editor');
  }
});

test('05 time', async ({ page }) => {
  const area = '05-time';
  await open(page, '/time');
  await expect(page.getByRole('heading', { name: 'Time' })).toBeVisible();
  await shot(page, area, 'month-calendar');
  for (let monthsAgo = 0; monthsAgo <= TIME_LOOKBACK_MONTHS; monthsAgo++) {
    await open(page, `/time?month=${monthKeyAgo(monthsAgo)}`);
    await settle(page);
    const loggedDays = page.locator(LOGGED_DAY_SELECTOR);
    if ((await loggedDays.count()) === 0) {
      continue;
    }
    await shot(page, area, 'month-with-logged-hours');
    await loggedDays.last().click();
    await shot(page, area, 'day-drawer-with-entries');
    break;
  }
  await open(page, '/time');
  await page.getByRole('tab', { name: 'Statistics' }).click();
  await expect(page.getByText(/h over \d+ day/)).toBeVisible({ timeout: 30_000 });
  await shot(page, area, 'statistics-this-month');
  await page.getByText('Last 12 months', { exact: true }).click();
  await shot(page, area, 'statistics-last-12-months');
  await page.getByRole('button', { name: 'New' }).click();
  await page.getByRole('menuitem', { name: 'Time entry' }).click();
  await expect(page.getByText('Log time').last()).toBeVisible();
  await shot(page, area, 'log-time-dialog');
});

test('06 work', async ({ page }) => {
  const area = '06-work';
  await open(page, '/work');
  await expect(page.locator('.column, .p-select, ac-empty-state').first()).toBeVisible();
  const views = page.locator('main .p-selectbutton .p-togglebutton');
  const viewCount = await views.count();
  for (let index = 0; index < viewCount; index++) {
    const label = (await views.nth(index).locator('[aria-label]').getAttribute('aria-label')) ?? '';
    await views.nth(index).click();
    await shot(page, area, `${label || `view-${String(index + 1)}`}-view`);
  }
  if (viewCount > 0) {
    await views.first().click();
  }
  if (await clickFirst(page.locator('article.card'))) {
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Description' })).toBeVisible();
    await shot(page, area, 'task-details-dialog');
    await dialog.getByRole('button', { name: 'Edit' }).click();
    await expect(dialog.getByRole('textbox', { name: 'Title' })).toBeVisible();
    await shot(page, area, 'task-edit-form');
  }
});

test('07 projects', async ({ page }) => {
  const area = '07-projects';
  await open(page, '/projects');
  await shot(page, area, 'project-list');
  const busiest = await busiestCard(page.locator('a.card'));
  if (busiest) {
    await busiest.click();
    await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible();
    await eachTab(page, area, 'project-hub', page.locator('main'));
  }
});

test('08 people', async ({ page }) => {
  const area = '08-people';
  await open(page, '/people');
  await shot(page, area, 'contact-list');
  if (await clickFirst(page.locator('a.entry'))) {
    await expect(page.getByRole('tab', { name: 'About' })).toBeVisible();
    await eachTab(page, area, 'contact', page.locator('main'));
  }
});

test('09 research', async ({ page }) => {
  const area = '09-research';
  await open(page, '/research');
  const libraryTab = page.getByRole('tab', { name: /Library/ });
  const tagPicker = page.getByText('Pick the tag marking your state-of-the-art papers');
  await expect(libraryTab.or(tagPicker)).toBeVisible();
  if (!(await libraryTab.isVisible())) {
    await shot(page, area, 'pick-sota-tag');
    return;
  }
  await expect(page.getByText(/validated ·/)).toBeVisible({ timeout: 30_000 });
  await shot(page, area, 'paper-library');
  if (await clickFirst(page.getByRole('button', { name: /Cite/ }))) {
    await expect(page.getByRole('dialog', { name: 'Cite' })).toBeVisible();
    await shot(page, area, 'cite-dialog');
    await page.keyboard.press('Escape');
  }
  await open(page, '/research?tab=map');
  await expect(page.locator('ac-graph canvas').first()).toBeVisible({ timeout: 30_000 });
  await eachTab(page, area, 'map', page.locator('main'));
});

test('10 assistant', async ({ page }) => {
  const area = '10-assistant';
  await open(page, '/assistant');
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible();
  await shot(page, area, 'new-conversation');
  if (await clickFirst(page.locator('nav[aria-label="Conversations"] button.session'))) {
    await expect(page.locator('.message').first()).toBeVisible();
    await shot(page, area, 'conversation-open');
  }
});

test('11 jobs', async ({ page }) => {
  await open(page, '/jobs');
  await shot(page, '11-jobs', 'background-jobs-page');
});

test('12 settings', async ({ page }) => {
  const area = '12-settings';
  await open(page, '/settings');
  await expect(page.getByRole('heading', { name: 'AI routing' })).toBeVisible();
  const headings = page.locator('main h2');
  const count = await headings.count();
  for (let index = 0; index < count; index++) {
    const heading = headings.nth(index);
    const label = (await heading.innerText()).trim();
    await heading.evaluate((element) => {
      element.scrollIntoView({ block: 'start' });
    });
    await shot(page, area, `section-${String(index + 1).padStart(2, '0')}-${label}`);
  }
  await page.getByRole('searchbox', { name: 'Find a setting' }).fill('ollama');
  await shot(page, area, 'search-ollama');
});
