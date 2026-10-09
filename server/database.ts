import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { currentStreak, datesInYear } from '../shared/dates.js';
import type { Dashboard, DayActivity, HeatmapRoutine, Routine, RoutineType } from '../shared/types.js';

export function openDatabase(filename: string): Database.Database {
  if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), { recursive: true });
  const db = new Database(filename);
  try {
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    const version = db.pragma('user_version', { simple: true }) as number;
    if (version > 3) throw new Error('Database schema is newer than this application supports.');
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
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function getDashboard(db: Database.Database, today: string): Dashboard {
  const year = Number(today.slice(0, 4));
  const routines = db.prepare(`
    SELECT r.id, r.name, r.type, r.position, r.accent_color AS accentColor, r.symbol,
      EXISTS (SELECT 1 FROM completions c WHERE c.routine_id = r.id AND c.date = ?) AS completed
    FROM routines r ORDER BY r.position, r.id
  `).all(today) as (Omit<Routine, 'completed'> & { completed: number })[];
  const normalized = routines.map((r) => ({ ...r, completed: Boolean(r.completed) }));

  // Filter on the server: a streak completion can never enter heatmap details/counts.
  const heatmapRows = db.prepare(`
    SELECT c.date, r.id, r.name, r.symbol FROM completions c
    JOIN routines r ON r.id = c.routine_id
    WHERE r.type = 'heatmap' AND c.date BETWEEN ? AND ?
    ORDER BY r.position, r.id
  `).all(`${year}-01-01`, today) as (DayActivity['completedRoutines'][number] & { date: string })[];
  const byDate = new Map<string, DayActivity['completedRoutines']>();
  for (const { date, ...routine } of heatmapRows) {
    const list = byDate.get(date) ?? [];
    list.push(routine);
    byDate.set(date, list);
  }
  const streakDates = db.prepare(`
    SELECT c.routine_id, c.date FROM completions c JOIN routines r ON r.id = c.routine_id
    WHERE r.type = 'streak' AND c.date <= ? ORDER BY c.date
  `).all(today) as { routine_id: number; date: string }[];
  return {
    today, year,
    heatmapRoutines: normalized.filter((r): r is HeatmapRoutine => r.type === 'heatmap'),
    streakRoutines: normalized.filter((r) => r.type === 'streak').map((r) => {
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
    SELECT ?, ?, COALESCE(MAX(position), -1) + 1, ?, ? FROM routines WHERE type = ?`)
    .run(name, type, accentColor, symbol, type);
}

export function updateRoutine(db: Database.Database, id: number, name: string, accentColor: string | undefined, symbol: string): void {
  if (!db.prepare('UPDATE routines SET name = ?, accent_color = COALESCE(?, accent_color), symbol = ? WHERE id = ?').run(name, accentColor ?? null, symbol, id).changes) {
    throw new RoutineError('Routine not found.', 404);
  }
}

export function reorderRoutines(db: Database.Database, type: RoutineType, ids: number[]): void {
  db.transaction(() => {
    const existing = db.prepare('SELECT id FROM routines WHERE type = ?').all(type) as { id: number }[];
    if (ids.length !== existing.length || new Set(ids).size !== ids.length || existing.some((r) => !ids.includes(r.id))) {
      throw new RoutineError('Provide every routine of this type exactly once. Refresh and try again.');
    }
    const update = db.prepare('UPDATE routines SET position = ? WHERE id = ?');
    ids.forEach((id, position) => update.run(position, id));
  })();
}

export function setCompletion(db: Database.Database, id: number, date: string, completed: boolean): void {
  db.transaction(() => {
    if (!db.prepare('SELECT 1 FROM routines WHERE id = ?').get(id)) throw new RoutineError('Routine not found.', 404);
    if (completed) db.prepare('INSERT OR IGNORE INTO completions (routine_id, date) VALUES (?, ?)').run(id, date);
    else db.prepare('DELETE FROM completions WHERE routine_id = ? AND date = ?').run(id, date);
  })();
}
