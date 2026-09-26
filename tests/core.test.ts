import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type Database from 'better-sqlite3';
import { createApp } from '../server/app.js';
import { createRoutine, getDashboard, openDatabase, setCompletion } from '../server/database.js';
import { calendarDate, completionLevel, datesInYear, localDate } from '../shared/dates.js';
import type { Dashboard } from '../shared/types.js';

describe('persisted routine API', () => {
  let directory: string;
  let db: Database.Database;
  let server: Server;
  let base: string;
  let today: string;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'core-routine-test-'));
    db = openDatabase(join(directory, 'routines.sqlite'));
    today = '2026-09-26';
    server = createApp(db, () => today).listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server address');
    base = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    if (server?.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (db?.open) db.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  function write(path: string, method: string, body: unknown) {
    return fetch(`${base}/api/${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  async function dashboard(): Promise<Dashboard> {
    const response = await fetch(`${base}/api/dashboard`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    return response.json() as Promise<Dashboard>;
  }

  it('creates, checks, reloads, unchecks, and persists through reopening SQLite', async () => {
    expect((await dashboard()).routines).toEqual([]);
    const created = await write('routines', 'POST', { name: '  Reading  ' });
    expect(created.status).toBe(201);
    const first = await dashboard();
    const id = first.routines[0].id;
    expect(first.routines).toEqual([{ id, name: 'Reading', completed: false }]);
    expect(first.days.find((day) => day.date === '2026-09-25')).toMatchObject({ active: 0, completed: 0 });
    expect((await write(`routines/${id}/completion`, 'PUT', { date: today, completed: true })).status).toBe(200);
    // Repeated PUT requests are idempotent.
    await write(`routines/${id}/completion`, 'PUT', { date: today, completed: true });
    expect((await dashboard()).days.find((day) => day.date === today)).toMatchObject({ active: 1, completed: 1 });
    db.close();
    db = openDatabase(join(directory, 'routines.sqlite'));
    expect(getDashboard(db, today).routines[0].completed).toBe(true);
    // The original app owns the original connection; restart its HTTP server too.
    await new Promise<void>((resolve) => server.close(() => resolve()));
    server = createApp(db, () => today).listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing address');
    base = `http://127.0.0.1:${address.port}`;
    expect((await dashboard()).routines[0].completed).toBe(true);
    expect((await write(`routines/${id}/completion`, 'PUT', { date: today, completed: false })).status).toBe(200);
    expect((await dashboard()).routines[0].completed).toBe(false);
    expect(db.prepare('SELECT count(*) AS count FROM completions').get()).toEqual({ count: 0 });
    db.close();
    db = openDatabase(join(directory, 'routines.sqlite'));
    expect(getDashboard(db, today).days.find((day) => day.date === today)).toMatchObject({ active: 1, completed: 0 });
  });

  it('rejects malformed input, missing routines, and stale dates without writing', async () => {
    for (const name of ['', '   ', 'x'.repeat(81), 42, null]) {
      expect((await write('routines', 'POST', { name })).status).toBe(400);
    }
    const malformed = await fetch(`${base}/api/routines`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).error).toBe('Invalid JSON request.');
    await write('routines', 'POST', { name: 'Gym' });
    expect((await write('routines/1/completion', 'PUT', { date: today, completed: 'true' })).status).toBe(400);
    expect((await write('routines/999/completion', 'PUT', { date: today, completed: true })).status).toBe(404);
    const yesterday = today;
    today = '2026-09-27';
    expect((await write('routines/1/completion', 'PUT', { date: yesterday, completed: true })).status).toBe(409);
    expect((await write('routines/1/completion', 'PUT', { date: '2026-02-30', completed: true })).status).toBe(409);
    expect((await dashboard()).routines[0].completed).toBe(false);
    expect(db.prepare('SELECT count(*) AS count FROM completions').get()).toEqual({ count: 0 });
  });

  it('uses active periods for historical denominators and preserves past completions', () => {
    createRoutine(db, 'Gym', '2026-09-24');
    setCompletion(db, 1, '2026-09-24', true);
    createRoutine(db, 'Reading', '2026-09-26');
    setCompletion(db, 2, today, true);
    const days = getDashboard(db, today).days;
    expect(days).toHaveLength(365);
    expect(days.find((day) => day.date === '2026-09-23')).toMatchObject({ active: 0, completed: 0 });
    expect(days.find((day) => day.date === '2026-09-24')).toMatchObject({ active: 1, completed: 1 });
    expect(days.find((day) => day.date === today)).toMatchObject({ active: 2, completed: 1 });
    expect(days.find((day) => day.date === '2026-09-27')).toMatchObject({ active: 0, completed: 0 });
    db.prepare('UPDATE routine_periods SET end_date = ? WHERE routine_id = 1').run('2026-09-25');
    expect(getDashboard(db, today).days.find((day) => day.date === '2026-09-24')).toMatchObject({ active: 1, completed: 1 });
    expect(getDashboard(db, today).days.find((day) => day.date === today)).toMatchObject({ active: 1, completed: 1 });
    expect(setCompletion(db, 1, today, true)).toBe(false);
  });
});

describe('calendar calculations', () => {
  it('includes every local date across leap years and daylight saving changes', () => {
    const priorTimezone = process.env.TZ;
    process.env.TZ = 'America/Chicago';
    try {
      const dates = datesInYear(2024);
      expect(dates).toHaveLength(366);
      expect(new Set(dates).size).toBe(366);
      expect(dates).toContain('2024-02-29');
      expect(dates.slice(0, 1)).toEqual(['2024-01-01']);
      expect(dates.at(-1)).toBe('2024-12-31');
      expect(dates.every((date) => localDate(calendarDate(date)) === date)).toBe(true);
      expect(localDate(new Date('2026-09-27T02:00:00Z'))).toBe('2026-09-26');
      expect(datesInYear(2026)).toHaveLength(365);
    } finally {
      if (priorTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = priorTimezone;
    }
  });

  it('maps completion ratios to all five heatmap levels', () => {
    expect(completionLevel(0, 0)).toBe(0);
    expect(completionLevel(0, 4)).toBe(0);
    expect(completionLevel(1, 3)).toBe(1);
    expect(completionLevel(2, 3)).toBe(2);
    expect(completionLevel(3, 4)).toBe(3);
    expect(completionLevel(4, 4)).toBe(4);
  });
});
