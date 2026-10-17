import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { createRoutine, openDatabase, setCompletion } from '../server/database.js';
import { localDate } from '../shared/dates.js';
import { themeColors } from '../shared/colors.js';
import type { Dashboard, RoutineType } from '../shared/types.js';

type TestApp = {
  db: ReturnType<typeof openDatabase>;
  url: string;
  restart: () => Promise<void>;
  snapshot: () => unknown;
};

const test = base.extend<{ app: TestApp }>({
  app: async ({ page }, use, testInfo) => {
    const directory = mkdtempSync(join(tmpdir(), 'routine-browser-'));
    const filename = join(directory, 'test.sqlite');
    const db = openDatabase(filename, '2024-01-01');
    for (const [type, names] of [
      ['heatmap', ['Reading', 'Gym', 'Study']], ['streak', ['Stretch', 'Water', 'Walk']],
    ] as const) {
      for (const name of names) createRoutine(db, name, type, '#216743', '');
    }
    for (const id of [1, 2, 4]) {
      setCompletion(db, id, localDate(), true);
      setCompletion(db, id, '2024-02-29', true);
    }
    createRoutine(db, 'Deleted heatmap', 'heatmap', '#216743', '📚');
    createRoutine(db, 'Deleted streak', 'streak', '#216743', '');
    for (const id of [7, 8]) setCompletion(db, id, '2024-02-29', true);
    db.prepare('UPDATE routines SET deleted_on = ? WHERE id IN (7, 8)').run(localDate());
    const portServer = createServer().listen(0, '127.0.0.1');
    await once(portServer, 'listening');
    const address = portServer.address();
    if (!address || typeof address === 'string') throw new Error('Missing test port');
    await new Promise<void>((resolve) => portServer.close(() => resolve()));
    const url = `http://127.0.0.1:${address.port}`;
    let child: ChildProcess | undefined;
    async function start() {
      child = spawn(process.execPath, ['dist/server/index.js'], {
        env: { ...process.env, DATABASE_PATH: filename, PORT: String(address && typeof address !== 'string' ? address.port : 0) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      await new Promise<void>((resolve, reject) => {
        child!.stdout!.on('data', (data: Buffer) => { if (data.toString().includes('Core Routine is running')) resolve(); });
        child!.once('error', reject);
        child!.once('exit', (code) => reject(new Error(`Test server exited: ${code}`)));
      });
    }
    async function stop() {
      if (child && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        child.kill('SIGTERM');
        await exited;
      }
    }
    const browserErrors: string[] = [];
    page.on('pageerror', (error) => browserErrors.push(error.message));
    page.on('console', (message) => {
      // Failed HTTP responses are intentional in the failure tests below.
      const intentionalFailure = /failed writes|settings failures/.test(testInfo.title) && message.text().startsWith('Failed to load resource:');
      if (message.type() === 'error' && !intentionalFailure) browserErrors.push(message.text());
    });
    try {
      await start();
      await use({ db, url, restart: async () => { await stop(); await start(); }, snapshot: () => ({
        metadata: db.prepare('SELECT id, name, type, accent_color, symbol, deleted_on FROM routines ORDER BY id').all(),
        completions: db.prepare('SELECT * FROM completions ORDER BY routine_id, date').all(),
        deleted: db.prepare('SELECT * FROM routines WHERE deleted_on IS NOT NULL ORDER BY id').all(),
      }) });
      expect(browserErrors).toEqual([]);
    } finally {
      await stop();
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
});

const management = (page: Page) => page.getByRole('dialog', { name: 'Manage routines', exact: true });
const list = (page: Page, type: RoutineType) => page.getByRole('list', { name: `${type === 'heatmap' ? 'Heatmap' : 'Streak'} routine order` });
const names = (page: Page, type: RoutineType) => list(page, type).getByRole('heading', { level: 4 });
const handle = (page: Page, name: string) => page.getByRole('button', { name: `Reorder ${name}`, exact: true });
async function openManagement(page: Page, url: string) {
  await page.goto(url);
  await page.getByRole('button', { name: 'Manage routines', exact: true }).click();
  await expect(management(page)).toBeVisible();
}
async function saved(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: /^Up to date$/ })).toHaveCount(1);
}
async function settled(page: Page) {
  await expect.poll(() => management(page).evaluate((node) =>
    node.getAnimations({ subtree: true }).filter((animation) => animation.playState === 'running' || animation.pending).length,
  )).toBe(0);
}
async function saveOrder(page: Page, drop: () => Promise<void>) {
  const response = page.waitForResponse((response) => response.request().method() === 'PUT'
    && new URL(response.url()).pathname === '/api/routines/order');
  await drop();
  const result = await response;
  expect(result.status()).toBe(200);
  expect(await result.finished()).toBeNull();
  await expect(page.locator('.routine-drag-preview')).toHaveCount(0);
  await saved(page);
  await settled(page);
}
async function keyboardDrag(page: Page, name: string, direction: 'ArrowUp' | 'ArrowDown', steps = 1) {
  const grip = handle(page, name);
  await expect(page.locator('.routine-drag-preview')).toHaveCount(0);
  await expect(grip).toHaveAttribute('aria-disabled', 'false');
  await grip.scrollIntoViewIfNeeded();
  await settled(page);
  await grip.focus();
  await expect(grip).toBeFocused();
  const order = await page.getByRole('list').filter({ has: grip }).getByRole('button', { name: /^Reorder / })
    .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')));
  let position = order.indexOf(`Reorder ${name}`) + 1;
  expect(position).toBeGreaterThan(0);
  await page.keyboard.press('Space');
  await expect(grip).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.routine-drag-preview')).toBeVisible();
  // The preview appears before dnd-kit has measured collisions and installed
  // its keyboard listener. The initial drag-over announcement confirms readiness.
  await expect(page.getByRole('status').filter({ hasText: `${name}, drop at position ${position} of ${order.length}.` })).toHaveCount(1);
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press(direction);
    position += direction === 'ArrowUp' ? -1 : 1;
    await expect(page.locator('.routine-drag-preview')).toContainText(`Position ${position} of ${order.length}`);
    await settled(page);
  }
}
async function keyboardMove(page: Page, name: string, direction: 'ArrowUp' | 'ArrowDown', steps = 1) {
  await keyboardDrag(page, name, direction, steps);
  await saveOrder(page, () => page.keyboard.press('Enter'));
}
async function pointerStart(page: Page, name: string) {
  const grip = handle(page, name);
  await expect(page.locator('.routine-drag-preview')).toHaveCount(0);
  await expect(grip).toHaveAttribute('aria-disabled', 'false');
  await grip.scrollIntoViewIfNeeded();
  await settled(page);
  const rect = (await grip.boundingBox())!;
  const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x, point.y + 8, { steps: 3 });
  await expect(grip).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.routine-drag-preview')).toBeVisible();
  return point;
}
async function pointerMove(page: Page, name: string, targetName: string) {
  await handle(page, targetName).scrollIntoViewIfNeeded();
  const point = await pointerStart(page, name);
  // Pickup may scroll the source into view. Measure after that scroll, before
  // crossing any rows starts the sortable transitions.
  const target = (await handle(page, targetName).boundingBox())!;
  await page.mouse.move(point.x, target.y + target.height / 2, { steps: 20 });
  const order = await page.getByRole('list').filter({ has: handle(page, name) }).getByRole('heading', { level: 4 }).allTextContents();
  await expect(page.locator('.routine-drag-preview')).toContainText(`Position ${order.indexOf(targetName) + 1} of ${order.length}`);
  await saveOrder(page, () => page.mouse.up());
}
async function dashboard(page: Page, url: string): Promise<Dashboard> {
  return (await page.request.get(`${url}/api/dashboard`)).json() as Promise<Dashboard>;
}

test('pointer and keyboard ordering stay independent and persist through reload and server restart', async ({ page, app }) => {
  const before = app.snapshot();
  await openManagement(page, app.url);
  await expect(management(page).getByRole('heading', { name: 'Appearance' })).toHaveCount(0);
  await expect(management(page).getByText('Deleted heatmap', { exact: true })).toHaveCount(0);
  let writes = 0;
  page.on('request', (request) => { if (request.method() === 'PUT' && request.url().includes('/routines/order')) writes++; });
  await pointerMove(page, 'Reading', 'Study');
  await expect(names(page, 'heatmap')).toHaveText(['Gym', 'Study', 'Reading']);
  await pointerMove(page, 'Reading', 'Gym');
  await expect(names(page, 'heatmap')).toHaveText(['Reading', 'Gym', 'Study']);
  await pointerMove(page, 'Stretch', 'Walk');
  await expect(names(page, 'streak')).toHaveText(['Water', 'Walk', 'Stretch']);
  await pointerMove(page, 'Stretch', 'Water');
  await expect(names(page, 'streak')).toHaveText(['Stretch', 'Water', 'Walk']);
  await keyboardMove(page, 'Study', 'ArrowUp', 2);
  await expect(names(page, 'heatmap')).toHaveText(['Study', 'Reading', 'Gym']);
  await expect(handle(page, 'Study')).toBeFocused();
  await keyboardMove(page, 'Stretch', 'ArrowDown', 2);
  await expect(names(page, 'streak')).toHaveText(['Water', 'Walk', 'Stretch']);
  expect(writes).toBe(6);
  expect(app.snapshot()).toEqual(before);
  const expected = await dashboard(page, app.url);
  await page.reload();
  await page.getByRole('button', { name: 'Manage routines', exact: true }).click();
  await expect(names(page, 'heatmap')).toHaveText(['Study', 'Reading', 'Gym']);
  await app.restart();
  await page.reload();
  await page.getByRole('button', { name: 'Manage routines', exact: true }).click();
  await expect(names(page, 'streak')).toHaveText(['Water', 'Walk', 'Stretch']);
  expect(await dashboard(page, app.url)).toEqual(expected);
  expect(app.snapshot()).toEqual(before);
});

test('cancelled, cross-type, no-op, and input gestures do not save; editing drafts survive reordering', async ({ page, app }) => {
  await page.setViewportSize({ width: 1440, height: 1800 });
  await openManagement(page, app.url);
  let writes = 0;
  page.on('request', (request) => { if (request.url().includes('/routines/order')) writes++; });
  const readingRow = list(page, 'heatmap').getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Reading', exact: true }) });
  const input = readingRow.getByRole('textbox', { name: 'Name', exact: true });
  await input.fill('Reading draft');
  await input.press('ArrowUp');
  const bounds = (await input.boundingBox())!;
  await page.mouse.move(bounds.x + 10, bounds.y + 10);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 100, bounds.y + 30, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.routine-drag-preview')).toHaveCount(0);
  await keyboardDrag(page, 'Reading', 'ArrowDown');
  await page.keyboard.press('Escape');
  await expect(page.locator('.routine-drag-preview')).toHaveCount(0);
  await settled(page);
  await expect(management(page)).toBeVisible();
  await expect(handle(page, 'Reading')).toBeFocused();
  await expect(names(page, 'heatmap')).toHaveText(['Reading', 'Gym', 'Study']);
  await pointerStart(page, 'Reading');
  const other = (await handle(page, 'Stretch').boundingBox())!;
  await page.mouse.move(other.x + 10, other.y + 10, { steps: 20 });
  await expect(page.locator('.routine-drag-preview')).toContainText('Outside list');
  await page.mouse.up();
  await expect(page.locator('.routine-drag-preview')).toHaveCount(0);
  await settled(page);
  await expect(names(page, 'heatmap')).toHaveText(['Reading', 'Gym', 'Study']);
  await expect(names(page, 'streak')).toHaveText(['Stretch', 'Water', 'Walk']);
  await handle(page, 'Reading').click();
  await keyboardDrag(page, 'Reading', 'ArrowDown', 0);
  await page.keyboard.press('Enter');
  await expect(page.locator('.routine-drag-preview')).toHaveCount(0);
  await settled(page);
  expect(writes).toBe(0);
  await keyboardMove(page, 'Reading', 'ArrowDown');
  await expect(names(page, 'heatmap')).toHaveText(['Gym', 'Reading', 'Study']);
  await expect(input).toHaveValue('Reading draft');
  await readingRow.getByRole('textbox', { name: 'Symbol', exact: true }).fill('📚');
  await readingRow.getByRole('button', { name: 'Save changes' }).click();
  await expect(handle(page, 'Reading draft')).toBeVisible();
  expect((await dashboard(page, app.url)).heatmapRoutines.find((r) => r.id === 1)).toMatchObject({ name: 'Reading draft', symbol: '📚' });
});

test('failed writes roll back atomically, survive failed recovery reads, and allow retry', async ({ page, app }) => {
  await openManagement(page, app.url);
  const before = app.snapshot();
  const positions = app.db.prepare('SELECT id, position FROM routines ORDER BY id').all();
  // Abort after at least one row has been updated to exercise transaction rollback.
  app.db.exec("CREATE TRIGGER fail_order BEFORE UPDATE OF position ON routines WHEN NEW.position = 1 BEGIN SELECT RAISE(ABORT, 'simulated order failure'); END;");
  await page.route('**/api/dashboard*', (route) => route.abort('failed'));
  await keyboardDrag(page, 'Reading', 'ArrowDown');
  const failedWrite = page.waitForResponse((response) => response.request().method() === 'PUT' && response.url().includes('/api/routines/order'));
  const failedRecovery = page.waitForEvent('requestfailed', (request) => request.url().includes('/api/dashboard'));
  await page.keyboard.press('Enter');
  expect((await failedWrite).status()).toBe(500);
  await failedRecovery;
  await expect(management(page).getByRole('alert')).toContainText('Unable to access');
  await expect(names(page, 'heatmap')).toHaveText(['Reading', 'Gym', 'Study']);
  await expect(management(page).getByRole('status').filter({ hasText: 'Could not confirm the save' })).toBeVisible();
  expect(app.db.prepare('SELECT id, position FROM routines ORDER BY id').all()).toEqual(positions);
  expect(app.snapshot()).toEqual(before);
  await page.unroute('**/api/dashboard*');
  app.db.exec('DROP TRIGGER fail_order');
  await keyboardMove(page, 'Reading', 'ArrowDown');
  await expect(names(page, 'heatmap')).toHaveText(['Gym', 'Reading', 'Study']);
  // A lost response after a successful write must reconcile with SQLite.
  await page.route('**/api/routines/order*', async (route) => {
    expect((await route.fetch()).status()).toBe(200);
    await route.abort('failed');
  });
  await keyboardDrag(page, 'Walk', 'ArrowUp');
  const lostResponse = page.waitForEvent('requestfailed', (request) => request.url().includes('/api/routines/order'));
  const recovery = page.waitForResponse((response) => response.request().method() === 'GET' && response.url().includes('/api/dashboard'));
  await page.keyboard.press('Enter');
  await lostResponse;
  expect((await recovery).status()).toBe(200);
  await expect(management(page).getByRole('alert')).toContainText('Failed to fetch');
  await expect(management(page).getByRole('status').filter({ hasText: 'Could not confirm the save' })).toBeVisible();
  await expect(handle(page, 'Walk')).toHaveAttribute('aria-disabled', 'false');
  await expect(names(page, 'streak')).toHaveText(['Stretch', 'Walk', 'Water']);
  expect((await dashboard(page, app.url)).streakRoutines.map((r) => r.name)).toEqual(['Stretch', 'Walk', 'Water']);
  expect(app.snapshot()).toEqual(before);
  await page.unroute('**/api/routines/order*');
});

test('scrolling long lists supports pointer autoscroll and keyboard moves at a narrow viewport', async ({ page, app }) => {
  for (let i = 1; i <= 12; i++) createRoutine(app.db, `Extra ${i}`, 'heatmap', '#216743', '');
  await page.setViewportSize({ width: 390, height: 844 });
  await openManagement(page, app.url);
  const before = app.snapshot();
  const point = await pointerStart(page, 'Reading');
  const dialog = (await management(page).boundingBox())!;
  await page.mouse.move(point.x, dialog.y + dialog.height - 12, { steps: 10 });
  await expect.poll(() => management(page).evaluate((node) => node.scrollTop)).toBeGreaterThan(600);
  await saveOrder(page, () => page.mouse.up());
  expect((await dashboard(page, app.url)).heatmapRoutines[0].name).not.toBe('Reading');
  await keyboardMove(page, 'Extra 12', 'ArrowUp', 14);
  await expect(names(page, 'heatmap').first()).toHaveText('Extra 12');
  expect(app.snapshot()).toEqual(before);
  expect(await page.locator('body').evaluate((node) => node.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/narrow-management.png' });
});

test('settings save all six colors and both modes, restore focus, and survive refresh/restart', async ({ page, app }) => {
  await page.goto(app.url);
  const plus = page.getByRole('button', { name: 'Manage routines', exact: true });
  const gear = page.getByRole('button', { name: 'Settings', exact: true });
  const plusBox = (await plus.boundingBox())!;
  const gearBox = (await gear.boundingBox())!;
  expect(gearBox.x).toBeGreaterThan(plusBox.x + plusBox.width);
  expect(gearBox.y).toBe(plusBox.y);
  expect(gearBox.y).toBeLessThan(100);
  const mainBounds = await page.locator('main').boundingBox();
  await gear.click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(settings.getByRole('button', { name: 'Close' })).toBeFocused();
  await expect(page.locator('dialog[open]')).toHaveCount(1);
  expect(await page.locator('main').boundingBox()).toEqual(mainBounds);
  await page.keyboard.press('Tab');
  await expect(settings.getByRole('combobox', { name: 'Mode' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(settings.getByRole('radio', { name: 'Green' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(settings.getByRole('button', { name: 'Close' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(settings.getByRole('radio', { name: 'Green' })).toBeFocused();
  await settings.getByRole('combobox', { name: 'Mode' }).selectOption('dark');
  await saved(page);
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark');
  for (const color of themeColors) {
    await settings.getByTitle(color.name, { exact: true }).click();
    await saved(page);
    await expect(settings.getByRole('radio', { name: color.name })).toBeChecked();
    expect((await dashboard(page, app.url)).appearance.color).toBe(color.value);
  }
  await page.screenshot({ path: 'test-results/desktop-settings-dark.png' });
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
  await expect(gear).toBeFocused();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark');
  await app.restart();
  await page.reload();
  await gear.click();
  await expect(settings.getByRole('radio', { name: 'Teal' })).toBeChecked();
  await expect(settings.getByRole('combobox')).toHaveValue('dark');
  await settings.getByRole('combobox').selectOption('light');
  await saved(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/narrow-settings-light.png' });
  await settings.getByRole('button', { name: 'Close' }).click();
  await expect(gear).toBeFocused();
  await plus.click();
  await expect(page.locator('dialog[open]')).toHaveCount(1);
  await expect(management(page).getByRole('combobox', { name: 'Mode' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(plus).toBeFocused();
});

test('only saves on drop and prevents overlapping reorder requests', async ({ page, app }) => {
  await openManagement(page, app.url);
  let writes = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/routines/order*', async (route) => {
    writes++;
    await gate;
    await route.continue();
  });
  try {
    await pointerStart(page, 'Reading');
    const target = (await handle(page, 'Study').boundingBox())!;
    await page.mouse.move(target.x + 20, target.y + 20, { steps: 20 });
    await expect(page.locator('.routine-drag-preview')).toContainText('Position 3 of 3');
    await expect.poll(() => list(page, 'heatmap').getByRole('listitem').evaluateAll((rows) => {
      const bounds = rows.map((row) => row.getBoundingClientRect()).sort((a, b) => a.top - b.top);
      return bounds.every((rect, index) => index === 0 || rect.top >= bounds[index - 1].bottom);
    })).toBe(true);
    expect(writes).toBe(0);
    expect((await dashboard(page, app.url)).heatmapRoutines.map((r) => r.name)).toEqual(['Reading', 'Gym', 'Study']);
    await page.screenshot({ path: 'test-results/desktop-drag.png' });
    await page.mouse.up();
    await expect.poll(() => writes).toBe(1);
    await expect(names(page, 'heatmap')).toHaveText(['Gym', 'Study', 'Reading']);
    await expect(handle(page, 'Gym')).toHaveAttribute('aria-disabled', 'true');
    await handle(page, 'Gym').focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.routine-drag-preview')).toHaveCount(0);
    expect(writes).toBe(1);
  } finally {
    release();
  }
  await saved(page);
  await keyboardMove(page, 'Reading', 'ArrowUp');
  expect(writes).toBe(2);
  await expect(names(page, 'heatmap')).toHaveText(['Gym', 'Reading', 'Study']);
});

test('settings failures recover and delete confirmation keeps history and focus behavior', async ({ page, app }) => {
  await page.goto(app.url);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  app.db.exec("CREATE TRIGGER fail_settings BEFORE UPDATE ON app_settings BEGIN SELECT RAISE(ABORT, 'simulated settings failure'); END;");
  await settings.getByRole('combobox').selectOption('dark');
  await expect(settings.getByRole('alert')).toContainText('Unable to access');
  await expect(settings.getByRole('combobox')).toHaveValue('light');
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'light');
  app.db.exec('DROP TRIGGER fail_settings');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Manage routines', exact: true }).click();
  const remove = management(page).getByRole('button', { name: 'Delete Reading', exact: true });
  await remove.click();
  const confirmation = page.getByRole('alertdialog');
  await expect(confirmation.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirmation).toHaveCount(0);
  await expect(remove).toBeFocused();
  const completions = app.db.prepare('SELECT * FROM completions ORDER BY routine_id, date').all();
  await remove.click();
  app.db.exec("CREATE TRIGGER fail_deletion BEFORE UPDATE OF deleted_on ON routines BEGIN SELECT RAISE(ABORT, 'simulated deletion failure'); END;");
  await confirmation.getByRole('button', { name: 'Delete routine', exact: true }).click();
  await expect(confirmation.getByRole('alert')).toContainText('Unable to access');
  await expect(confirmation).toBeVisible();
  app.db.exec('DROP TRIGGER fail_deletion');
  await confirmation.getByRole('button', { name: 'Delete routine', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(management(page).getByRole('button', { name: 'Close' })).toBeFocused();
  await expect(handle(page, 'Reading')).toHaveCount(0);
  expect(app.db.prepare('SELECT * FROM completions ORDER BY routine_id, date').all()).toEqual(completions);
});

test('empty and single-routine lists, creation, year navigation and heatmap editing still work', async ({ page, app }) => {
  app.db.exec("UPDATE routines SET deleted_on = '2026-01-01' WHERE id != 1");
  await openManagement(page, app.url);
  await expect(handle(page, 'Reading')).toHaveAttribute('aria-disabled', 'true');
  await handle(page, 'Reading').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('.routine-drag-preview')).toHaveCount(0);
  await expect(management(page).getByText('No streak routines yet.')).toBeVisible();
  const create = management(page).locator('.create-routine');
  await create.getByRole('textbox', { name: 'Name', exact: true }).fill('New streak');
  await create.getByRole('combobox', { name: 'Type' }).selectOption('streak');
  await create.getByRole('textbox', { name: 'Symbol' }).fill('💧');
  await create.getByRole('button', { name: 'Add routine' }).click();
  await expect(handle(page, 'New streak')).toBeVisible();
  await expect(handle(page, 'New streak')).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '2024', exact: true }).click();
  const day = page.locator('.day-cell').filter({ hasText: '' }).first();
  await day.focus();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await day.press('Enter');
  await expect(page.locator('.date-editor')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(day).toBeFocused();
});
