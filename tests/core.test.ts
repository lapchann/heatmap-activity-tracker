import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import Database from 'better-sqlite3';
import { createApp } from '../server/app.js';
import { getDashboard, openDatabase } from '../server/database.js';
import { calendarDate, completionLevel, currentStreak, datesInYear, isCalendarDate, localDate, previousDate } from '../shared/dates.js';
import type { Dashboard } from '../shared/types.js';
import { themeColors } from '../shared/colors.js';

describe('typed routine API and persistence', () => {
  let directory: string;
  let db: Database.Database;
  let server: Server;
  let base: string;
  let today: string;
  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'routine-test-'));
    today = '2026-10-04';
    db = openDatabase(join(directory, 'routines.sqlite'), today);
    server = createApp(db, () => today).listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');
    base = `http://127.0.0.1:${address.port}`;
  });
  afterEach(async () => {
    if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (db?.open) db.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  });
  function write(path: string, body: unknown, method = 'PUT') {
    return fetch(`${base}/api/${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  async function create(name: string, type: 'heatmap' | 'streak', symbol = '') {
    const response = await write('routines', { name, type, symbol }, 'POST');
    expect(response.status).toBe(201);
    const data = await response.json() as Dashboard;
    return [...data.heatmapRoutines, ...data.streakRoutines].find((r) => r.name === name)!.id;
  }
  async function dashboard(year?: number): Promise<Dashboard> {
    const response = await fetch(`${base}/api/dashboard${year === undefined ? '' : `?year=${year}`}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    return response.json() as Promise<Dashboard>;
  }
  async function complete(id: number, date = today, completed = true) {
    const response = await write(`routines/${id}/completion`, { date, completed });
    expect(response.status).toBe(200);
    return response.json() as Promise<Dashboard>;
  }

  it('isolates heatmap counts/details from each individual streak history', async () => {
    const gym = await create('Gym', 'heatmap', '🏋️');
    const stretch = await create('Stretch', 'streak', '🧘');
    const water = await create('Water', 'streak', '💧');
    const empty = await dashboard();
    expect(empty.heatmapRoutines.map((r) => r.id)).toEqual([gym]);
    expect(empty.streakRoutines.map((r) => r.id)).toEqual([stretch, water]);
    const streakOnly = await complete(stretch);
    expect(streakOnly.days).toEqual(empty.days);
    expect(streakOnly.streakRoutines.map((r) => r.streak)).toEqual([1, 0]);
    const both = await complete(gym);
    expect(both.streakRoutines).toEqual(streakOnly.streakRoutines);
    expect(both.days.find((d) => d.date === today)).toEqual({ date: today, count: 1, completedRoutines: [{ id: gym, name: 'Gym', symbol: '🏋️' }] });
    expect(both.heatmapRoutines[0]).not.toHaveProperty('streak');
    await complete(water, previousDate(today));
    const separate = await dashboard();
    expect(separate.streakRoutines.map((r) => r.streak)).toEqual([1, 1]);
    expect(separate.streakRoutines[0].completionDates).toEqual([today]);
    expect(separate.streakRoutines[1].completionDates).toEqual([previousDate(today)]);
  });

  it('counts one completion per routine/date with fixed levels and no denominator', async () => {
    for (let count = 1; count <= 5; count++) {
      const id = await create(`Routine ${count}`, 'heatmap');
      await complete(id);
      const data = await complete(id);
      const day = data.days.find((d) => d.date === today)!;
      expect(day.count).toBe(count);
      expect(day.completedRoutines).toHaveLength(count);
      expect(completionLevel(day.count)).toBe(Math.min(count, 4));
      expect(day).not.toHaveProperty('active');
    }
    const before = await dashboard();
    await create('Later addition', 'heatmap');
    expect((await dashboard()).days).toEqual(before.days);
    expect(db.prepare('SELECT count(*) AS count FROM completions').get()).toEqual({ count: 5 });
    expect(() => db.prepare('INSERT INTO completions VALUES (1, ?)').run(today)).toThrow();
  });

  it('persists historical heatmap edits and recalculates streak corrections immediately', async () => {
    const heatmap = await create('Project', 'heatmap', '💻');
    const streak = await create('Stretch', 'streak', '🧘');
    const past = '2026-10-01';
    await complete(heatmap, past);
    await complete(streak, '2026-10-01');
    await complete(streak, '2026-10-03');
    expect((await dashboard()).streakRoutines[0].streak).toBe(1);
    const corrected = await complete(streak, '2026-10-02');
    expect(corrected.streakRoutines[0].streak).toBe(3);
    expect(corrected.streakRoutines[0].completed).toBe(false);
    expect((await complete(streak)).streakRoutines[0].streak).toBe(4);
    expect((await complete(streak, today, false)).streakRoutines[0].streak).toBe(3);
    expect((await complete(streak, '2026-10-02', false)).streakRoutines[0].streak).toBe(1);
    expect((await dashboard()).days.find((d) => d.date === past)?.count).toBe(1);
    await complete(heatmap, past, false);
    const final = await dashboard();
    expect(final.days.find((d) => d.date === past)?.count).toBe(0);
    db.close();
    db = openDatabase(join(directory, 'routines.sqlite'));
    expect(getDashboard(db, today)).toEqual(final);
    today = '2026-10-05';
    expect(getDashboard(db, today).streakRoutines[0].streak).toBe(0);
  });

  it('saves appearance and order within each type without changing completion history', async () => {
    const gym = await create('Gym', 'heatmap');
    const reading = await create('Reading', 'heatmap');
    const stretch = await create('Stretch', 'streak');
    const water = await create('Water', 'streak');
    await complete(gym);
    await complete(stretch);
    const before = db.prepare('SELECT * FROM completions ORDER BY routine_id, date').all();
    expect((await write(`routines/${gym}`, { name: 'Strength', accentColor: '#8054ad', symbol: '💪' })).status).toBe(200);
    expect((await write('routines/order', { type: 'heatmap', ids: [reading, gym] })).status).toBe(200);
    expect((await write('routines/order', { type: 'streak', ids: [water, stretch] })).status).toBe(200);
    expect((await write('routines/order', { type: 'heatmap', ids: [stretch, gym] })).status).toBe(409);
    expect((await write('routines/order', { type: 'heatmap', ids: [gym, gym] })).status).toBe(409);
    expect((await write(`routines/${gym}`, { name: 'Strength', type: 'streak' })).status).toBe(400);
    const data = await dashboard();
    expect(data.heatmapRoutines.map((r) => r.id)).toEqual([reading, gym]);
    expect(data.streakRoutines.map((r) => r.id)).toEqual([water, stretch]);
    expect(data.heatmapRoutines[1]).toMatchObject({ name: 'Strength', type: 'heatmap', accentColor: '#8054ad', symbol: '💪', completed: true });
    expect(data.days.find((d) => d.date === today)?.completedRoutines[0]).toMatchObject({ name: 'Strength', symbol: '💪' });
    expect(db.prepare('SELECT * FROM completions ORDER BY routine_id, date').all()).toEqual(before);
    db.close(); db = openDatabase(join(directory, 'routines.sqlite'));
    expect(getDashboard(db, today)).toEqual(data);
  });

  it('rejects invalid fields, future edits, and obsolete lifecycle routes without writing', async () => {
    for (const body of [
      { name: '', type: 'heatmap' }, { name: 'x'.repeat(81), type: 'heatmap' },
      { name: 'Missing type' }, { name: 'Invalid', type: 'both' },
      { name: 'Invalid', type: 'streak', symbol: 'two words' }, { name: 'Invalid', type: 'heatmap', accentColor: 'red' },
      { name: 'Old lifecycle', type: 'heatmap', startDate: today },
    ]) expect((await write('routines', body, 'POST')).status).toBe(400);
    const id = await create('Gym', 'heatmap', '🏋️');
    const streak = await create('Stretch', 'streak', '👨‍👩‍👧‍👦');
    for (const routineId of [id, streak]) {
      for (const date of ['2026-10-05', '2026-02-29', '2024-02-30', '2026-1-1', '2026-10-04T00:00:00Z', null]) {
        expect((await write(`routines/${routineId}/completion`, { date, completed: true })).status).toBe(400);
      }
    }
    expect((await write(`routines/${id}/completion`, { date: today, completed: 'true' })).status).toBe(400);
    expect((await write(`routines/${id}/completion`, { date: previousDate(today), completed: true, todayOnly: true })).status).toBe(409);
    expect((await write('routines/999/completion', { date: today, completed: true })).status).toBe(404);
    expect((await write('routines/1x/completion', { date: today, completed: true })).status).toBe(400);
    expect((await write(`routines/${id}/archive`, { effectiveDate: today }, 'POST')).status).toBe(404);
    expect((await write(`routines/${id}/reactivate`, { effectiveDate: today }, 'POST')).status).toBe(404);
    expect((await write(`routines/${id}`, {}, 'DELETE')).status).toBe(404);
    expect(db.prepare('SELECT * FROM completions').all()).toEqual([]);
    expect(() => db.prepare("UPDATE routines SET type = 'both' WHERE id = ?").run(id)).toThrow();
    expect((await write(`routines/${id}/completion`, { date: '2024-02-29', completed: true })).status).toBe(200);
  });

  it('defaults both types to blank symbols and clears symbols without changing history or stored colors', async () => {
    for (const type of ['heatmap', 'streak']) {
      expect((await write('routines', { name: type, type }, 'POST')).status).toBe(201);
    }
    const initial = await dashboard();
    expect(initial.heatmapRoutines[0].symbol).toBe('');
    expect(initial.streakRoutines[0].symbol).toBe('');
    const id = initial.heatmapRoutines[0].id;
    await complete(id);
    await write(`routines/${id}`, { name: 'Custom', symbol: '📚', accentColor: '#8054ad' });
    expect((await write(`routines/${id}`, { name: 'No symbol', symbol: '' })).status).toBe(200);
    const final = await dashboard();
    expect(final.heatmapRoutines[0]).toMatchObject({ id, name: 'No symbol', symbol: '', accentColor: '#8054ad', completed: true });
    expect(final.days.find((day) => day.date === today)).toMatchObject({ count: 1, completedRoutines: [{ id, symbol: '' }] });
    expect((await write(`routines/${id}`, { name: 'Invalid', symbol: 'two' })).status).toBe(400);
    expect((await write(`routines/${id}`, { name: 'Invalid', symbol: null })).status).toBe(400);
    db.close(); db = openDatabase(join(directory, 'routines.sqlite'));
    expect(getDashboard(db, today)).toEqual(final);
  });

  it('loads eligible calendar years and leap days without changing today or streak calculations', async () => {
    db.prepare('UPDATE app_settings SET first_use_date = ?').run('2024-06-15');
    const heatmap = await create('Reading', 'heatmap', '📚');
    const streak = await create('Stretch', 'streak', '🧘');
    for (const date of ['2024-02-29', '2024-12-31', '2025-01-01', today]) await complete(heatmap, date);
    for (const date of ['2024-02-29', previousDate(today), today]) await complete(streak, date);
    const current = await dashboard();
    expect(current).toMatchObject({ year: 2026, firstYear: 2024, today });
    expect(current.days).toHaveLength(365);
    expect(current.days.filter((day) => day.count)).toHaveLength(1);
    for (const year of [2024, 2025]) {
      const past = await dashboard(year);
      expect(past).toMatchObject({ year, firstYear: 2024, today });
      expect(past.days.map((day) => day.date)).toEqual(datesInYear(year));
      expect(past.days[0].date).toBe(`${year}-01-01`);
      expect(past.days.at(-1)?.date).toBe(`${year}-12-31`);
      expect(past.heatmapRoutines).toEqual(current.heatmapRoutines);
      expect(past.streakRoutines).toEqual(current.streakRoutines);
      expect(past.days.filter((day) => day.count).map((day) => day.date)).toEqual(year === 2024 ? ['2024-02-29', '2024-12-31'] : ['2025-01-01']);
    }
    expect((await dashboard(2024)).days.find((day) => day.date === '2024-02-29')).toEqual({
      date: '2024-02-29', count: 1, completedRoutines: [{ id: heatmap, name: 'Reading', symbol: '📚' }],
    });
    expect(current.days.filter((day) => day.date > today).every((day) => day.count === 0 && day.completedRoutines.length === 0)).toBe(true);
  });

  it('preserves the selected response year across historical edits and independent daily mutations', async () => {
    db.prepare('UPDATE app_settings SET first_use_date = ?').run('2024-01-01');
    const heatmap = await create('Project', 'heatmap', '💻');
    const streak = await create('Stretch', 'streak', '🧘');
    await complete(heatmap, '2025-06-01');
    const otherYear = (await dashboard(2025)).days;
    const response = await write(`routines/${heatmap}/completion?year=2024`, { date: '2024-02-29', completed: true });
    expect(response.status).toBe(200);
    const edited = await response.json() as Dashboard;
    expect(edited.year).toBe(2024);
    expect(edited.days.find((day) => day.date === '2024-02-29')?.count).toBe(1);
    expect(edited.heatmapRoutines[0].completed).toBe(false);
    expect((await dashboard(2025)).days).toEqual(otherYear);
    const daily = await write(`routines/${heatmap}/completion?year=2024`, { date: today, completed: true, todayOnly: true });
    const dailyData = await daily.json() as Dashboard;
    expect(dailyData.year).toBe(2024);
    expect(dailyData.days).toEqual(edited.days);
    expect(dailyData.heatmapRoutines[0].completed).toBe(true);
    const streakResponse = await write(`routines/${streak}/completion?year=2024`, { date: today, completed: true });
    const streakData = await streakResponse.json() as Dashboard;
    expect(streakData.year).toBe(2024);
    expect(streakData.days).toEqual(edited.days);
    expect(streakData.streakRoutines[0]).toMatchObject({ streak: 1, completed: true });
    for (const [path, body, method] of [
      ['routines', { name: 'New', type: 'heatmap' }, 'POST'],
      [`routines/${heatmap}`, { name: 'Work', symbol: '💻' }, 'PUT'],
      ['settings', { color: '#2864b4', mode: 'dark' }, 'PUT'],
    ] as const) {
      const saved = await write(`${path}?year=2024`, body, method);
      expect((await saved.json() as Dashboard).year).toBe(2024);
    }
    db.close(); db = openDatabase(join(directory, 'routines.sqlite'), '2027-01-01');
    expect(getDashboard(db, today, 2024).days.find((day) => day.date === '2024-02-29')?.count).toBe(1);
    expect(getDashboard(db, today, 2025).days).toEqual(otherYear.map((day) => ({
      ...day, completedRoutines: day.completedRoutines.map((routine) => ({ ...routine, name: 'Work' })),
    })));
  });

  it('uses persisted first use rather than backfilled activity and advances the available range at New Year', async () => {
    const empty = await dashboard();
    expect(empty).toMatchObject({ firstYear: 2026, year: 2026 });
    const heatmap = await create('Backfill', 'heatmap');
    await complete(heatmap, '2010-01-01');
    expect((await dashboard()).firstYear).toBe(2026);
    expect((await fetch(`${base}/api/dashboard?year=2010`)).status).toBe(400);
    today = '2027-01-01';
    expect(await dashboard()).toMatchObject({ firstYear: 2026, year: 2027, today });
    expect(await dashboard(2026)).toMatchObject({ firstYear: 2026, year: 2026, today });
    expect(db.prepare('SELECT first_use_date FROM app_settings').get()).toEqual({ first_use_date: '2026-10-04' });
  });

  it('rejects invalid or unavailable response years before writing', async () => {
    const id = await create('Gym', 'heatmap');
    for (const year of ['', '2025', '2027', '2026.5', '2026abc', '026', '10000', '2026&year=2025']) {
      expect((await fetch(`${base}/api/dashboard?year=${year}`)).status).toBe(400);
      expect((await write(`routines/${id}/completion?year=${year}`, { date: today, completed: true })).status).toBe(400);
    }
    expect(db.prepare('SELECT * FROM completions').all()).toEqual([]);
  });

  it('persists every global color and both modes without altering routine metadata or history', async () => {
    const heatmap = await create('Reading', 'heatmap', '📚');
    const streak = await create('Stretch', 'streak', '🧘');
    await complete(heatmap); await complete(streak);
    const routines = db.prepare('SELECT * FROM routines ORDER BY id').all();
    const completions = db.prepare('SELECT * FROM completions ORDER BY routine_id, date').all();
    expect((await dashboard()).appearance).toEqual({ color: '#216743', mode: 'light' });
    for (const { value: color } of themeColors) {
      for (const mode of ['light', 'dark']) {
        const response = await write('settings', { color, mode });
        expect(response.status).toBe(200);
        expect((await response.json() as Dashboard).appearance).toEqual({ color, mode });
        expect((await dashboard()).appearance).toEqual({ color, mode });
      }
    }
    const final = await dashboard();
    db.close(); db = openDatabase(join(directory, 'routines.sqlite'), '2028-01-01');
    expect(getDashboard(db, today)).toEqual(final);
    expect(db.prepare('SELECT * FROM routines ORDER BY id').all()).toEqual(routines);
    expect(db.prepare('SELECT * FROM completions ORDER BY routine_id, date').all()).toEqual(completions);
    expect(db.prepare('SELECT first_use_date FROM app_settings').get()).toEqual({ first_use_date: '2026-10-04' });
  });

  it('rejects malformed settings and attempts to alter the first-use boundary', async () => {
    const before = await dashboard();
    for (const body of [
      {}, null, [], { color: '#ffffff', mode: 'light' }, { color: '#216743', mode: 'system' },
      { color: '#216743' }, { mode: 'dark' }, { color: 123, mode: 'dark' },
      { color: '#216743', mode: 'dark', firstUseDate: '2000-01-01' },
    ]) expect((await write('settings', body)).status).toBe(400);
    expect(await dashboard()).toEqual(before);
  });
});

for (const version of [0, 1]) {
  it(`migrates schema v${version}, preserving all IDs, completions and available appearance/order`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'routine-migration-'));
    const filename = join(directory, 'old.sqlite');
    let db = new Database(filename);
    try {
      db.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE routines (id INTEGER PRIMARY KEY, name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80));
        CREATE TABLE routine_periods (id INTEGER PRIMARY KEY, routine_id INTEGER NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
          start_date TEXT NOT NULL, end_date TEXT CHECK (end_date IS NULL OR end_date ${version === 0 ? '>' : '>='} start_date)
          ${version === 0 ? ', UNIQUE (routine_id, start_date)' : ''});
        CREATE UNIQUE INDEX one_open_period_per_routine ON routine_periods(routine_id) WHERE end_date IS NULL;
        CREATE TABLE completions (routine_id INTEGER NOT NULL REFERENCES routines(id) ON DELETE CASCADE, date TEXT NOT NULL,
          PRIMARY KEY (routine_id, date));
        INSERT INTO routines VALUES (3, 'Gym'), (8, 'Reading');
        INSERT INTO routine_periods VALUES (1, 3, '2026-01-01', NULL), (2, 8, '2026-01-01', '2026-02-01');
        INSERT INTO completions VALUES (3, '2026-10-04'), (8, '2026-01-15'), (8, '2026-03-10'), (8, '2027-01-01');
        PRAGMA user_version = ${version};
      `);
      if (version === 1) db.exec(`
        ALTER TABLE routines ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE routines ADD COLUMN accent_color TEXT NOT NULL DEFAULT '#216743';
        UPDATE routines SET position = CASE id WHEN 3 THEN 1 ELSE 0 END, accent_color = '#2864b4';
      `);
      const completions = db.prepare('SELECT * FROM completions ORDER BY routine_id, date').all();
      db.close(); db = openDatabase(filename);
      const data = getDashboard(db, '2026-10-04');
      expect(data.heatmapRoutines.map((r) => r.id)).toEqual(version === 0 ? [3, 8] : [8, 3]);
      expect(data.heatmapRoutines.every((r) => r.type === 'heatmap' && r.symbol === '')).toBe(true);
      expect(data.heatmapRoutines[0].accentColor).toBe(version === 0 ? '#216743' : '#2864b4');
      expect(data.streakRoutines).toEqual([]);
      expect(data.days.find((d) => d.date === '2026-03-10')?.count).toBe(1);
      expect(db.prepare('SELECT * FROM completions ORDER BY routine_id, date').all()).toEqual(completions);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()).toEqual([{ name: 'app_settings' }, { name: 'completions' }, { name: 'routines' }]);
      expect(db.pragma('foreign_key_check')).toEqual([]);
      expect(db.pragma('user_version', { simple: true })).toBe(4);
      db.close(); db = openDatabase(filename);
      expect(getDashboard(db, '2026-10-04')).toEqual(data);
    } finally {
      if (db.open) db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

it('migrates v2 placeholder symbols and SQLite defaults while preserving custom symbols and completions', () => {
  const directory = mkdtempSync(join(tmpdir(), 'symbol-migration-'));
  const filename = join(directory, 'old.sqlite');
  let db = new Database(filename);
  try {
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE routines (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'heatmap' CHECK (type IN ('heatmap', 'streak')),
        position INTEGER NOT NULL DEFAULT 0, accent_color TEXT NOT NULL DEFAULT '#216743', symbol TEXT NOT NULL DEFAULT '●'
      );
      CREATE TABLE completions (routine_id INTEGER NOT NULL REFERENCES routines(id) ON DELETE CASCADE, date TEXT NOT NULL, PRIMARY KEY (routine_id, date));
      INSERT INTO routines (id, name, type, position, accent_color, symbol) VALUES
        (3, 'Old default', 'heatmap', 4, '#8054ad', '●'),
        (5, 'Old streak', 'streak', 2, '#2864b4', '●'),
        (8, 'Reading', 'heatmap', 1, '#2864b4', '📚'),
        (9, 'Custom bullet', 'streak', 3, '#216743', '•');
      INSERT INTO completions VALUES (3, '2026-10-04'), (5, '2026-10-04'), (8, '2026-10-04'), (9, '2026-10-03');
      PRAGMA user_version = 2;
    `);
    const before = db.prepare('SELECT * FROM completions ORDER BY routine_id, date').all();
    db.close(); db = openDatabase(filename);
    const data = getDashboard(db, '2026-10-04');
    expect(data.heatmapRoutines).toMatchObject([
      { id: 8, symbol: '📚', position: 1, accentColor: '#2864b4' },
      { id: 3, symbol: '', position: 4, accentColor: '#8054ad' },
    ]);
    expect(data.streakRoutines).toMatchObject([{ id: 5, symbol: '', streak: 1 }, { id: 9, symbol: '•', streak: 1 }]);
    expect(db.prepare('SELECT * FROM completions ORDER BY routine_id, date').all()).toEqual(before);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('user_version', { simple: true })).toBe(4);
    db.prepare("INSERT INTO routines (id, name) VALUES (10, 'SQL default')").run();
    expect(db.prepare('SELECT symbol FROM routines WHERE id = 10').get()).toEqual({ symbol: '' });
    db.close(); db = openDatabase(filename);
    expect(getDashboard(db, '2026-10-04').heatmapRoutines.find((r) => r.id === 8)?.symbol).toBe('📚');
  } finally {
    if (db.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it('upgrades v3 with an honest first-use fallback and retains all existing activity and metadata', () => {
  const directory = mkdtempSync(join(tmpdir(), 'settings-migration-'));
  const filename = join(directory, 'v3.sqlite');
  let db = new Database(filename);
  try {
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE routines (id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
        position INTEGER NOT NULL, accent_color TEXT NOT NULL, symbol TEXT NOT NULL DEFAULT '');
      CREATE TABLE completions (routine_id INTEGER NOT NULL REFERENCES routines(id), date TEXT NOT NULL,
        PRIMARY KEY (routine_id, date));
      INSERT INTO routines VALUES (8, 'Reading', 'heatmap', 3, '#8054ad', '📚'), (12, 'Stretch', 'streak', 2, '#2864b4', '');
      INSERT INTO completions VALUES (8, '2019-12-31'), (8, '2026-10-01'), (12, '2026-10-01');
      PRAGMA user_version = 3;
    `);
    const routines = db.prepare('SELECT * FROM routines ORDER BY id').all();
    const completions = db.prepare('SELECT * FROM completions ORDER BY routine_id, date').all();
    db.close(); db = openDatabase(filename, '2026-10-09');
    expect(db.pragma('user_version', { simple: true })).toBe(4);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.prepare('SELECT * FROM routines ORDER BY id').all()).toEqual(routines);
    expect(db.prepare('SELECT * FROM completions ORDER BY routine_id, date').all()).toEqual(completions);
    expect(getDashboard(db, '2026-10-09')).toMatchObject({ firstYear: 2026, appearance: { color: '#216743', mode: 'light' } });
    expect(() => getDashboard(db, '2026-10-09', 2019)).toThrow('Choose a year between 2026 and 2026.');
    db.close(); db = openDatabase(filename, '2027-02-01');
    expect(db.prepare('SELECT first_use_date FROM app_settings').get()).toEqual({ first_use_date: '2026-10-09' });
    expect(getDashboard(db, '2027-02-01', 2026).days.find((day) => day.date === '2026-10-01')?.count).toBe(1);
  } finally {
    if (db.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('local calendar and streak boundaries', () => {
  it('retains yesterday’s 12-day streak until today ends, extends today, and breaks after a missed day', () => {
    const today = '2026-10-04';
    const dates: string[] = [];
    let date = today;
    for (let i = 0; i < 12; i++) { date = previousDate(date); dates.push(date); }
    expect(currentStreak(dates, today)).toBe(12);
    expect(currentStreak([...dates, today], today)).toBe(13);
    expect(currentStreak(dates, '2026-10-05')).toBe(0);
    expect(currentStreak([], today)).toBe(0);
  });
  it.each([
    ['2027-01-01', ['2026-12-30', '2026-12-31', '2027-01-01'], 3],
    ['2024-03-01', ['2024-02-28', '2024-02-29', '2024-03-01'], 3],
    ['2024-03-01', ['2024-02-28', '2024-03-01'], 1],
    ['2026-03-09', ['2026-03-07', '2026-03-08', '2026-03-09'], 3],
    ['2026-11-02', ['2026-10-31', '2026-11-01', '2026-11-02'], 3],
  ] as const)('counts across calendar boundaries for %s', (today, dates, count) => {
    expect(currentStreak(dates, today)).toBe(count);
  });
  it('keeps dates local across DST, leap years, and UTC midnight', () => {
    const priorTimezone = process.env.TZ;
    process.env.TZ = 'America/Chicago';
    try {
      const dates = datesInYear(2024);
      expect(dates).toHaveLength(366);
      expect(new Set(dates).size).toBe(366);
      expect(dates.every((date) => localDate(calendarDate(date)) === date)).toBe(true);
      expect(localDate(new Date('2026-10-05T02:00:00Z'))).toBe('2026-10-04');
      expect(previousDate('2026-03-09')).toBe('2026-03-08');
      expect(previousDate('2026-11-02')).toBe('2026-11-01');
      expect(datesInYear(2026)).toHaveLength(365);
      expect(isCalendarDate('2024-02-29')).toBe(true);
      expect(isCalendarDate('2026-02-29')).toBe(false);
    } finally {
      if (priorTimezone === undefined) delete process.env.TZ; else process.env.TZ = priorTimezone;
    }
  });
  it('uses only fixed absolute heatmap levels', () => {
    expect([0, 1, 2, 3, 4, 5, 100].map(completionLevel)).toEqual([0, 1, 2, 3, 4, 4, 4]);
  });
});
