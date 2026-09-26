import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { datesInYear } from '../shared/dates.js';
import type { Dashboard } from '../shared/types.js';

export function openDatabase(filename: string): Database.Database {
  if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), { recursive: true });
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS routines (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80)
    );
    -- Start is inclusive; end is exclusive. An open period has no end date.
    CREATE TABLE IF NOT EXISTS routine_periods (
      id INTEGER PRIMARY KEY,
      routine_id INTEGER NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
      start_date TEXT NOT NULL CHECK (start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
      end_date TEXT CHECK (end_date IS NULL OR end_date > start_date),
      UNIQUE (routine_id, start_date)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_open_period_per_routine
      ON routine_periods(routine_id) WHERE end_date IS NULL;
    CREATE TABLE IF NOT EXISTS completions (
      routine_id INTEGER NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
      date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
      PRIMARY KEY (routine_id, date)
    );
  `);
  return db;
}

export function getDashboard(db: Database.Database, today: string): Dashboard {
  const year = Number(today.slice(0, 4));
  const routines = db.prepare(`
    SELECT r.id, r.name,
      EXISTS (SELECT 1 FROM completions c WHERE c.routine_id = r.id AND c.date = ?) AS completed
    FROM routines r
    WHERE EXISTS (
      SELECT 1 FROM routine_periods p WHERE p.routine_id = r.id
        AND p.start_date <= ? AND (p.end_date IS NULL OR p.end_date > ?)
    )
    ORDER BY r.id
  `).all(today, today, today) as { id: number; name: string; completed: number }[];

  const periods = db.prepare(`
    SELECT routine_id, start_date, end_date FROM routine_periods
    WHERE start_date <= ? AND (end_date IS NULL OR end_date > ?)
  `).all(`${year}-12-31`, `${year}-01-01`) as {
    routine_id: number; start_date: string; end_date: string | null;
  }[];
  const completions = db.prepare('SELECT routine_id, date FROM completions WHERE date BETWEEN ? AND ?')
    .all(`${year}-01-01`, today) as { routine_id: number; date: string }[];
  const completedKeys = new Set(completions.map((row) => `${row.routine_id}:${row.date}`));

  const days = datesInYear(year).map((date) => {
    if (date > today) return { date, active: 0, completed: 0 };
    const activeIds = new Set(periods
      .filter((period) => period.start_date <= date && (period.end_date === null || period.end_date > date))
      .map((period) => period.routine_id));
    const completed = [...activeIds].filter((id) => completedKeys.has(`${id}:${date}`)).length;
    return { date, active: activeIds.size, completed };
  });
  return { today, year, routines: routines.map((r) => ({ ...r, completed: Boolean(r.completed) })), days };
}

export function createRoutine(db: Database.Database, name: string, today: string): void {
  db.transaction(() => {
    const result = db.prepare('INSERT INTO routines (name) VALUES (?)').run(name);
    db.prepare('INSERT INTO routine_periods (routine_id, start_date) VALUES (?, ?)')
      .run(result.lastInsertRowid, today);
  })();
}

export function setCompletion(db: Database.Database, id: number, date: string, completed: boolean): boolean {
  return db.transaction(() => {
    const active = db.prepare(`
      SELECT 1 FROM routine_periods WHERE routine_id = ?
        AND start_date <= ? AND (end_date IS NULL OR end_date > ?)
    `).get(id, date, date);
    if (!active) return false;
    if (completed) {
      db.prepare('INSERT OR IGNORE INTO completions (routine_id, date) VALUES (?, ?)').run(id, date);
    } else {
      db.prepare('DELETE FROM completions WHERE routine_id = ? AND date = ?').run(id, date);
    }
    return true;
  })();
}
