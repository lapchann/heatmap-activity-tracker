import express from 'express';
import type { ErrorRequestHandler } from 'express';
import type Database from 'better-sqlite3';
import { isCalendarDate, localDate } from '../shared/dates.js';
import { defaultRoutineColor, themeColors } from '../shared/colors.js';
import type { RoutineType } from '../shared/types.js';
import { createRoutine, deleteRoutine, getDashboard, reorderRoutines, resolveHeatmapYear, RoutineError, setCompletion, updateAppearance, updateRoutine } from './database.js';

function validType(value: unknown): value is RoutineType { return value === 'heatmap' || value === 'streak'; }

function metadata(body: Record<string, unknown>) {
  const { name, accentColor, symbol = '' } = body;
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) throw new RoutineError('Enter a routine name between 1 and 80 characters.', 400);
  if (accentColor !== undefined && (typeof accentColor !== 'string' || !themeColors.some((color) => color.value === accentColor))) throw new RoutineError('Choose an available accent color.', 400);
  if (typeof symbol !== 'string' || symbol.length > 16 || (symbol !== '' && (!/[\p{L}\p{N}\p{P}\p{S}]/u.test(symbol)
    || /[\s\p{Cc}]/u.test(symbol) || [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(symbol)].length !== 1))) {
    throw new RoutineError('Leave the symbol blank or choose one symbol or emoji (up to 16 characters).', 400);
  }
  return { name: name.trim(), accentColor, symbol };
}

function fields(body: unknown, allowed: string[]): asserts body is Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new RoutineError('Unsupported request fields.', 400);
  }
}

export function createApp(db: Database.Database, today = () => localDate()) {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use(express.json({ limit: '4kb' }));
  app.use('/api', (req, res, next) => {
    const year = req.query.year;
    if (year !== undefined && (typeof year !== 'string' || !/^[1-9]\d{3}$/.test(year))) {
      throw new RoutineError('Provide a four-digit calendar year.', 400);
    }
    res.locals.today = today();
    // Validate the response year before any mutation can write data.
    res.locals.year = resolveHeatmapYear(db, res.locals.today, year === undefined ? undefined : Number(year)).year;
    next();
  });
  app.param('id', (_req, _res, next, value: string) => {
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) return next(new RoutineError('Provide a valid routine ID.', 400));
    next();
  });
  app.get('/api/dashboard', (_req, res) => res.json(getDashboard(db, res.locals.today, res.locals.year)));

  app.put('/api/settings', (req, res) => {
    fields(req.body, ['color', 'mode']);
    const color = themeColors.find((color) => color.value === req.body.color)?.value;
    const { mode } = req.body;
    if (!color || (mode !== 'light' && mode !== 'dark')) throw new RoutineError('Choose an available color and light or dark mode.', 400);
    updateAppearance(db, { color, mode });
    res.json(getDashboard(db, res.locals.today, res.locals.year));
  });

  app.post('/api/routines', (req, res) => {
    fields(req.body, ['name', 'type', 'accentColor', 'symbol']);
    if (!validType(req.body.type)) throw new RoutineError('Choose heatmap or streak as the routine type.', 400);
    const { name, accentColor, symbol } = metadata(req.body);
    createRoutine(db, name, req.body.type, accentColor ?? defaultRoutineColor, symbol);
    res.status(201).json(getDashboard(db, res.locals.today, res.locals.year));
  });
  app.put('/api/routines/order', (req, res) => {
    fields(req.body, ['type', 'ids']);
    const { type, ids } = req.body;
    if (!validType(type) || !Array.isArray(ids) || !ids.every((id) => Number.isSafeInteger(id) && id > 0)) throw new RoutineError('Provide a routine type and its ordered routine IDs.', 400);
    reorderRoutines(db, type, ids);
    res.json(getDashboard(db, res.locals.today, res.locals.year));
  });
  app.put('/api/routines/:id', (req, res) => {
    fields(req.body, ['name', 'accentColor', 'symbol']);
    const { name, accentColor, symbol } = metadata(req.body);
    updateRoutine(db, Number(req.params.id), name, accentColor, symbol);
    res.json(getDashboard(db, res.locals.today, res.locals.year));
  });
  app.delete('/api/routines/:id', (req, res) => {
    fields(req.body === undefined ? {} : req.body, []);
    deleteRoutine(db, Number(req.params.id), res.locals.today);
    res.json(getDashboard(db, res.locals.today, res.locals.year));
  });
  app.put('/api/routines/:id/completion', (req, res) => {
    fields(req.body, ['date', 'completed', 'todayOnly']);
    const { date, completed, todayOnly = false } = req.body;
    const currentDate: string = res.locals.today;
    if (!isCalendarDate(date) || date > currentDate || typeof completed !== 'boolean' || typeof todayOnly !== 'boolean') throw new RoutineError('Choose today or a valid past date and boolean completion options.', 400);
    if (todayOnly && date !== currentDate) throw new RoutineError('The day changed. Refresh and try today’s control again.');
    setCompletion(db, Number(req.params.id), date, completed);
    res.json(getDashboard(db, currentDate, res.locals.year));
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
  const handleError: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error instanceof RoutineError) { res.status(error.status).json({ error: error.message }); return; }
    const status = (error as { status?: number })?.status;
    if (status === 400 || status === 413) {
      res.status(status).json({ error: status === 413 ? 'Request body is too large.' : 'Invalid JSON request.' });
      return;
    }
    console.error('Request failed:', error);
    res.status(500).json({ error: 'Unable to access your routine data. Please try again.' });
  };
  app.use(handleError);
  return app;
}
