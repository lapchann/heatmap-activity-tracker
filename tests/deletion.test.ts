import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import Database from 'better-sqlite3';
import { createApp } from '../server/app.js';
import { getDashboard, openDatabase } from '../server/database.js';
import type { Dashboard, RoutineType } from '../shared/types.js';

describe('non-destructive routine deletion', () => {
  let directory: string;
  let filename: string;
  let db: Database.Database;
  let server: Server;
  let base: string;
  let today: string;

  async function start() {
    server = createApp(db, () => today).listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');
    base = `http://127.0.0.1:${address.port}/api`;
  }
  async function stop() {
    if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'routine-deletion-'));
    filename = join(directory, 'routines.sqlite');
    db = openDatabase(filename, '2024-01-01');
    today = '2026-10-09';
    await start();
  });
  afterEach(async () => {
    await stop();
    if (db?.open) db.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
    vi.restoreAllMocks();
  });
  function write(path: string, body: unknown = {}, method = 'PUT') {
    return fetch(`${base}/${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  async function dashboard(year?: number): Promise<Dashboard> {
    const response = await fetch(`${base}/dashboard${year === undefined ? '' : `?year=${year}`}`);
    expect(response.status).toBe(200);
    return response.json() as Promise<Dashboard>;
  }
  async function create(name: string, type: RoutineType, symbol = '') {
    const response = await write('routines', { name, type, symbol }, 'POST');
    expect(response.status).toBe(201);
    const data = await response.json() as Dashboard;
    return [...data.heatmapRoutines, ...data.streakRoutines].find((routine) => routine.name === name)!.id;
  }
  async function complete(id: number, date = today) {
    expect((await write(`routines/${id}/completion`, { date, completed: true })).status).toBe(200);
  }
  async function remove(id: number, year?: number): Promise<Dashboard> {
    const response = await write(`routines/${id}${year === undefined ? '' : `?year=${year}`}`, {}, 'DELETE');
    expect(response.status).toBe(200);
    return response.json() as Promise<Dashboard>;
  }
  function completions() { return db.prepare('SELECT * FROM completions ORDER BY routine_id, date').all(); }

  it('removes heatmap tracking while retaining same-day, historical, and leap-year counts and symbols', async () => {
    const gym = await create('Gym', 'heatmap', '🏋️');
    const reading = await create('Reading', 'heatmap', '📚');
    const streak = await create('Stretch', 'streak', '🧘');
    for (const date of ['2024-02-29', '2025-12-31', '2026-10-07', today]) await complete(gym, date);
    await complete(reading, '2026-10-07'); await complete(streak);
    await write('settings', { color: '#8054ad', mode: 'dark' });
    const before = await dashboard();
    const past = await dashboard(2024);
    const rows = completions();
    const metadata = db.prepare('SELECT * FROM routines WHERE id = ?').get(gym) as Record<string, unknown>;
    const settings = db.prepare('SELECT * FROM app_settings').get();
    const deleted = await remove(gym, 2024);
    expect(deleted).toMatchObject({ year: 2024, firstYear: 2024, appearance: before.appearance });
    expect(deleted.heatmapRoutines.map((routine) => routine.id)).toEqual([reading]);
    expect(deleted.deletedHeatmapRoutines).toMatchObject([{ id: gym, name: 'Gym', symbol: '🏋️', deletedOn: today }]);
    expect(deleted.streakRoutines).toEqual(before.streakRoutines);
    expect(deleted.days).toEqual(past.days);
    expect((await dashboard()).days).toEqual(before.days);
    expect((await dashboard()).days.find((day) => day.date === today)).toEqual({
      date: today, count: 1, completedRoutines: [{ id: gym, name: 'Gym', symbol: '🏋️' }],
    });
    expect(db.prepare('SELECT * FROM routines WHERE id = ?').get(gym)).toEqual({ ...metadata, deleted_on: today });
    expect(completions()).toEqual(rows);
    expect(db.prepare('SELECT * FROM app_settings').get()).toEqual(settings);
  });

  it('allows heatmap corrections before deletion but makes deletion-day completions read-only', async () => {
    const gym = await create('Gym', 'heatmap', '🏋️');
    await complete(gym); await remove(gym);
    for (const date of ['2024-02-29', '2026-10-08']) {
      const response = await write(`routines/${gym}/completion?year=2024`, { date, completed: true });
      expect(response.status).toBe(200);
      expect((await response.json() as Dashboard).year).toBe(2024);
      expect((await write(`routines/${gym}/completion`, { date, completed: false })).status).toBe(200);
    }
    for (const completed of [true, false]) {
      expect((await write(`routines/${gym}/completion`, { date: today, completed })).status).toBe(409);
    }
    expect((await write(`routines/${gym}/completion`, { date: '2026-10-10', completed: true })).status).toBe(400);
    today = '2026-10-11';
    for (const date of ['2026-10-09', '2026-10-10', today]) {
      for (const completed of [true, false]) expect((await write(`routines/${gym}/completion`, { date, completed })).status).toBe(409);
    }
    expect(completions()).toEqual([{ routine_id: gym, date: '2026-10-09' }]);
    expect((await dashboard()).heatmapRoutines).toEqual([]);
    expect((await dashboard()).days.find((day) => day.date === '2026-10-09')?.count).toBe(1);
  });

  it('rejects a first completion on the deletion date without inventing activity', async () => {
    const id = await create('No symbol', 'heatmap');
    await remove(id);
    expect((await write(`routines/${id}/completion`, { date: today, completed: true })).status).toBe(409);
    expect(completions()).toEqual([]);
    expect((await dashboard()).days.every((day) => day.count === 0)).toBe(true);
    await complete(id, '2026-10-08');
    expect((await dashboard()).days.find((day) => day.date === '2026-10-08')?.completedRoutines).toEqual([{ id, name: 'No symbol', symbol: '' }]);
  });

  it('removes only the deleted streak card and rejects all of its further writes without affecting the heatmap', async () => {
    const gym = await create('Gym', 'heatmap', '🏋️');
    const stretch = await create('Stretch', 'streak', '🧘');
    const water = await create('Water', 'streak', '💧');
    await complete(gym); await complete(stretch); await complete(stretch, '2026-10-08'); await complete(water);
    const before = await dashboard();
    const rows = completions();
    const removed = await remove(stretch);
    expect(removed.streakRoutines).toEqual(before.streakRoutines.filter((routine) => routine.id === water));
    expect(removed.days).toEqual(before.days);
    expect(removed.heatmapRoutines).toEqual(before.heatmapRoutines);
    expect(removed.deletedHeatmapRoutines).toEqual([]);
    for (const date of ['2026-10-07', '2026-10-08', today]) {
      for (const completed of [true, false]) expect((await write(`routines/${stretch}/completion`, { date, completed })).status).toBe(409);
    }
    expect(completions()).toEqual(rows);
  });

  it('keeps deletion idempotent across days and rejects customization or ordering of deleted routines', async () => {
    const gym = await create('Gym', 'heatmap', '🏋️');
    const read = await create('Reading', 'heatmap', '📚');
    const code = await create('Coding', 'heatmap', '💻');
    await complete(gym, '2026-10-07');
    await remove(gym);
    const deletedRecord = db.prepare('SELECT * FROM routines WHERE id = ?').get(gym);
    today = '2026-10-10';
    await remove(gym);
    expect(db.prepare('SELECT * FROM routines WHERE id = ?').get(gym)).toEqual(deletedRecord);
    expect((await write(`routines/${gym}`, { name: 'Changed', symbol: 'x' })).status).toBe(404);
    expect((await write('routines/order', { type: 'heatmap', ids: [code, read, gym] })).status).toBe(409);
    expect((await write('routines/order', { type: 'heatmap', ids: [code, read] })).status).toBe(200);
    const newGym = await create('Gym', 'heatmap', '💪');
    expect(newGym).not.toBe(gym);
    expect((await dashboard()).heatmapRoutines.map((routine) => routine.id)).toEqual([code, read, newGym]);
    expect(db.prepare('SELECT * FROM routines WHERE id = ?').get(gym)).toEqual(deletedRecord);
    expect((await dashboard()).days.find((day) => day.date === '2026-10-07')?.completedRoutines).toEqual([{ id: gym, name: 'Gym', symbol: '🏋️' }]);
  });

  it('keeps both types removed after reload/restart without changing settings or the first-use boundary', async () => {
    const heatmap = await create('Project', 'heatmap', '💻');
    const streak = await create('Stretch', 'streak', '🧘');
    await complete(heatmap); await complete(heatmap, '2024-02-29'); await complete(streak);
    await write('settings', { color: '#2864b4', mode: 'dark' });
    await remove(heatmap); await remove(streak);
    const before = await dashboard(2024);
    const rows = completions();
    expect(await dashboard(2024)).toEqual(before);
    await stop(); db.close(); db = openDatabase(filename, '2028-01-01'); await start();
    expect(await dashboard(2024)).toEqual(before);
    expect(completions()).toEqual(rows);
    expect(before).toMatchObject({ heatmapRoutines: [], streakRoutines: [], firstYear: 2024, appearance: { color: '#2864b4', mode: 'dark' } });
    expect(db.prepare('SELECT first_use_date FROM app_settings').get()).toEqual({ first_use_date: '2024-01-01' });
  });

  it('validates IDs, response years, and request fields before deleting', async () => {
    const id = await create('Gym', 'heatmap');
    for (const body of [{ date: today }, { deletedOn: today }, { effectiveDate: '2026-10-10' }, { restore: true }]) {
      expect((await write(`routines/${id}`, body, 'DELETE')).status).toBe(400);
    }
    expect((await write(`routines/${id}?year=2023`, {}, 'DELETE')).status).toBe(400);
    expect((await write('routines/1x', {}, 'DELETE')).status).toBe(400);
    expect((await write('routines/999', {}, 'DELETE')).status).toBe(404);
    expect((await dashboard()).heatmapRoutines[0]).toMatchObject({ id, deletedOn: null });
    expect((await fetch(`${base}/routines/${id}`, { method: 'DELETE' })).status).toBe(200);
  });

  it.each(['heatmap', 'streak'] as const)('leaves %s tracking and all history intact when persistence fails', async (type) => {
    const id = await create('Keep me', type, '📚');
    await complete(id);
    const before = await dashboard();
    const rows = completions();
    db.exec("CREATE TRIGGER fail_deletion BEFORE UPDATE OF deleted_on ON routines BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END;");
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failed = await write(`routines/${id}`, {}, 'DELETE');
    expect(failed.status).toBe(500);
    expect(await dashboard()).toEqual(before);
    expect(completions()).toEqual(rows);
    expect(logged).toHaveBeenCalled();
    db.exec('DROP TRIGGER fail_deletion');
    await remove(id);
    expect(db.prepare('SELECT deleted_on FROM routines WHERE id = ?').get(id)).toEqual({ deleted_on: today });
    expect(completions()).toEqual(rows);
  });
});

it('migrates v4 by adding only a nullable marker, retaining metadata, completions, appearance and first use', () => {
  const directory = mkdtempSync(join(tmpdir(), 'deletion-migration-'));
  const filename = join(directory, 'v4.sqlite');
  let db = new Database(filename);
  try {
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE routines (id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
        position INTEGER NOT NULL, accent_color TEXT NOT NULL, symbol TEXT NOT NULL DEFAULT '');
      CREATE TABLE completions (routine_id INTEGER NOT NULL REFERENCES routines(id) ON DELETE CASCADE, date TEXT NOT NULL,
        PRIMARY KEY (routine_id, date));
      CREATE TABLE app_settings (id INTEGER PRIMARY KEY CHECK (id = 1), first_use_date TEXT NOT NULL,
        theme_color TEXT NOT NULL, appearance_mode TEXT NOT NULL);
      INSERT INTO routines VALUES (8, 'Reading', 'heatmap', 3, '#8054ad', '📚'), (12, 'Stretch', 'streak', 2, '#2864b4', '');
      INSERT INTO completions VALUES (8, '2024-02-29'), (8, '2026-10-09'), (12, '2026-10-09');
      INSERT INTO app_settings VALUES (1, '2024-06-15', '#2864b4', 'dark');
      PRAGMA user_version = 4;
    `);
    const routines = db.prepare('SELECT * FROM routines ORDER BY id').all() as Record<string, unknown>[];
    const completions = db.prepare('SELECT * FROM completions ORDER BY routine_id, date').all();
    const settings = db.prepare('SELECT * FROM app_settings').all();
    const tables = db.prepare("SELECT name, rootpage FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
    db.close(); db = openDatabase(filename, '2026-10-09');
    expect(db.pragma('user_version', { simple: true })).toBe(5);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.prepare('SELECT * FROM routines ORDER BY id').all()).toEqual(routines.map((routine) => ({ ...routine, deleted_on: null })));
    expect(db.prepare('SELECT * FROM completions ORDER BY routine_id, date').all()).toEqual(completions);
    expect(db.prepare('SELECT * FROM app_settings').all()).toEqual(settings);
    expect(db.prepare("SELECT name, rootpage FROM sqlite_master WHERE type = 'table' ORDER BY name").all()).toEqual(tables);
    const data = getDashboard(db, '2026-10-09', 2024);
    expect(data).toMatchObject({ firstYear: 2024, year: 2024, appearance: { color: '#2864b4', mode: 'dark' }, deletedHeatmapRoutines: [] });
    expect(data.days.find((day) => day.date === '2024-02-29')?.count).toBe(1);
    db.close(); db = openDatabase(filename, '2028-01-01');
    expect(getDashboard(db, '2026-10-09', 2024)).toEqual(data);
  } finally {
    if (db.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
