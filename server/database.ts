import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { currentStreak, datesInYear, localDate } from '../shared/dates.js';
import type { Appearance, Dashboard, DayActivity, HeatmapRoutine, Routine, RoutineType } from '../shared/types.js';

export function openDatabase(filename: string, firstUseDate = localDate()): Database.Database {
  if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), { recursive: true });
  const db = new Database(filename);
  try {
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    const version = db.pragma('user_version', { simple: true }) as number;
    if (version > 5) throw new Error('Database schema is newer than this application supports.');
    if (version < 2) db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS routines (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
          type TEXT NOT NULL DEFAULT 'heatmap' CHECK (type IN ('heatmap', 'streak')),
          position INTEGER NOT NULL DEFAULT 0,
          accent_color TEXT NOT NULL DEFAULT '#216743',
          symbol TEXT NOT NULL DEFAULT '●'
        );
        CREATE TABLE IF NOT EXISTS completions (
          routine_id INTEGER NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
          date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
          PRIMARY KEY (routine_id, date)
        );
      `);
      const columns = (db.pragma('table_info(routines)') as { name: string }[]).map((column) => column.name);
      // v0: Milestone 1; v1: uncommitted lifecycle development schema.
      if (!columns.includes('position')) {
        db.exec('ALTER TABLE routines ADD COLUMN position INTEGER NOT NULL DEFAULT 0; UPDATE routines SET position = id;');
      }
      if (!columns.includes('accent_color')) db.exec("ALTER TABLE routines ADD COLUMN accent_color TEXT NOT NULL DEFAULT '#216743'");
      if (!columns.includes('type')) db.exec("ALTER TABLE routines ADD COLUMN type TEXT NOT NULL DEFAULT 'heatmap' CHECK (type IN ('heatmap', 'streak'))");
      if (!columns.includes('symbol')) db.exec("ALTER TABLE routines ADD COLUMN symbol TEXT NOT NULL DEFAULT '●'");
      // Periods are obsolete. Dropping this child table leaves every completion intact.
      db.exec('DROP TABLE IF EXISTS routine_periods; PRAGMA user_version = 2;');
    })();
    if (version < 3) db.transaction(() => {
      // Replace only this column to change its SQLite default as well as the old placeholder.
      db.exec(`
        ALTER TABLE routines ADD COLUMN symbol_v3 TEXT NOT NULL DEFAULT '';
        UPDATE routines SET symbol_v3 = CASE WHEN symbol = '●' THEN '' ELSE symbol END;
        ALTER TABLE routines DROP COLUMN symbol;
        ALTER TABLE routines RENAME COLUMN symbol_v3 TO symbol;
        PRAGMA user_version = 3;
      `);
    })();
    if (version < 4) db.transaction(() => {
      db.exec(`
        CREATE TABLE app_settings (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          first_use_date TEXT NOT NULL,
          theme_color TEXT NOT NULL DEFAULT '#216743',
          appearance_mode TEXT NOT NULL DEFAULT 'light' CHECK (appearance_mode IN ('light', 'dark'))
        );
      `);
      // Earlier schemas have no trustworthy creation metadata. Record this upgrade,
      // not the oldest completion: activity dates may have been backfilled.
      db.prepare('INSERT INTO app_settings (id, first_use_date) VALUES (1, ?)').run(firstUseDate);
      db.pragma('user_version = 4');
    })();
    if (version < 5) db.transaction(() => {
      db.exec('ALTER TABLE routines ADD COLUMN deleted_on TEXT; PRAGMA user_version = 5;');
    })();
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function getSettings(db: Database.Database): Appearance & { firstUseDate: string } {
  return db.prepare('SELECT first_use_date AS firstUseDate, theme_color AS color, appearance_mode AS mode FROM app_settings WHERE id = 1')
    .get() as Appearance & { firstUseDate: string };
}

export function resolveHeatmapYear(db: Database.Database, today: string, requestedYear?: number) {
  const currentYear = Number(today.slice(0, 4));
  const firstYear = Math.min(currentYear, Number(getSettings(db).firstUseDate.slice(0, 4)));
  const year = requestedYear ?? currentYear;
  if (!Number.isInteger(year) || year < firstYear || year > currentYear) {
    throw new RoutineError(`Choose a year between ${firstYear} and ${currentYear}.`, 400);
  }
  return { year, firstYear };
}

export function updateAppearance(db: Database.Database, appearance: Appearance): void {
  db.prepare('UPDATE app_settings SET theme_color = ?, appearance_mode = ? WHERE id = 1').run(appearance.color, appearance.mode);
}

export function getDashboard(db: Database.Database, today: string, requestedYear?: number): Dashboard {
  const { year, firstYear } = resolveHeatmapYear(db, today, requestedYear);
  const { color, mode } = getSettings(db);
  const routines = db.prepare(`
    SELECT r.id, r.name, r.type, r.position, r.accent_color AS accentColor, r.symbol, r.deleted_on AS deletedOn,
      EXISTS (SELECT 1 FROM completions c WHERE c.routine_id = r.id AND c.date = ?) AS completed
    FROM routines r ORDER BY r.position, r.id
  `).all(today) as (Omit<Routine, 'completed'> & { completed: number })[];
  const normalized = routines.map((r) => ({ ...r, completed: Boolean(r.completed) }));
  const active = normalized.filter((r) => r.deletedOn === null);

  // Keep deleted heatmap routines in history, including their deletion-day activity.
  // Streak completions never enter heatmap details/counts.
  const heatmapRows = db.prepare(`
    SELECT c.date, r.id, r.name, r.symbol FROM completions c
    JOIN routines r ON r.id = c.routine_id
    WHERE r.type = 'heatmap' AND c.date BETWEEN ? AND ?
    ORDER BY r.position, r.id
  `).all(`${year}-01-01`, year < Number(today.slice(0, 4)) ? `${year}-12-31` : today) as (DayActivity['completedRoutines'][number] & { date: string })[];
  const byDate = new Map<string, DayActivity['completedRoutines']>();
  for (const { date, ...routine } of heatmapRows) {
    const list = byDate.get(date) ?? [];
    list.push(routine);
    byDate.set(date, list);
  }
  const streakDates = db.prepare(`
    SELECT c.routine_id, c.date FROM completions c JOIN routines r ON r.id = c.routine_id
    WHERE r.type = 'streak' AND r.deleted_on IS NULL AND c.date <= ? ORDER BY c.date
  `).all(today) as { routine_id: number; date: string }[];
  return {
    today, year, firstYear, appearance: { color, mode },
    heatmapRoutines: active.filter((r): r is HeatmapRoutine => r.type === 'heatmap'),
    deletedHeatmapRoutines: normalized.filter((r): r is HeatmapRoutine => r.type === 'heatmap' && r.deletedOn !== null),
    streakRoutines: active.filter((r) => r.type === 'streak').map((r) => {
      const completionDates = streakDates.filter((c) => c.routine_id === r.id).map((c) => c.date);
      return { ...r, type: 'streak', completionDates, streak: currentStreak(completionDates, today) };
    }),
    days: datesInYear(year).map((date) => {
      const completedRoutines = byDate.get(date) ?? [];
      return { date, count: completedRoutines.length, completedRoutines };
    }),
  };
}

export class RoutineError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

export function createRoutine(db: Database.Database, name: string, type: RoutineType, accentColor: string, symbol: string): void {
  db.prepare(`INSERT INTO routines (name, type, position, accent_color, symbol)
    SELECT ?, ?, COALESCE(MAX(position), -1) + 1, ?, ? FROM routines WHERE type = ? AND deleted_on IS NULL`)
    .run(name, type, accentColor, symbol, type);
}

export function updateRoutine(db: Database.Database, id: number, name: string, accentColor: string | undefined, symbol: string): void {
  if (!db.prepare('UPDATE routines SET name = ?, accent_color = COALESCE(?, accent_color), symbol = ? WHERE id = ? AND deleted_on IS NULL').run(name, accentColor ?? null, symbol, id).changes) {
    throw new RoutineError('Routine not found or no longer tracked.', 404);
  }
}

export function deleteRoutine(db: Database.Database, id: number, today: string): void {
  // Repeated requests are safe, including retries after a lost response on a later day.
  if (!db.prepare('UPDATE routines SET deleted_on = COALESCE(deleted_on, ?) WHERE id = ?').run(today, id).changes) {
    throw new RoutineError('Routine not found.', 404);
  }
}

export function reorderRoutines(db: Database.Database, type: RoutineType, ids: number[]): void {
  db.transaction(() => {
    const existing = db.prepare('SELECT id FROM routines WHERE type = ? AND deleted_on IS NULL').all(type) as { id: number }[];
    if (ids.length !== existing.length || new Set(ids).size !== ids.length || existing.some((r) => !ids.includes(r.id))) {
      throw new RoutineError('Provide every tracked routine of this type exactly once. Refresh and try again.');
    }
    const update = db.prepare('UPDATE routines SET position = ? WHERE id = ?');
    ids.forEach((id, position) => update.run(position, id));
  })();
}

export function setCompletion(db: Database.Database, id: number, date: string, completed: boolean): void {
  db.transaction(() => {
    const routine = db.prepare('SELECT type, deleted_on AS deletedOn FROM routines WHERE id = ?').get(id) as Pick<Routine, 'type' | 'deletedOn'> | undefined;
    if (!routine) throw new RoutineError('Routine not found.', 404);
    if (routine.deletedOn !== null && (routine.type === 'streak' || date >= routine.deletedOn)) {
      throw new RoutineError('This routine was deleted. Only heatmap dates before its deletion can be edited.');
    }
    if (completed) db.prepare('INSERT OR IGNORE INTO completions (routine_id, date) VALUES (?, ?)').run(id, date);
    else db.prepare('DELETE FROM completions WHERE routine_id = ? AND date = ?').run(id, date);
  })();
}
