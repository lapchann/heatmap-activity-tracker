import express from 'express';
import type { ErrorRequestHandler } from 'express';
import type Database from 'better-sqlite3';
import { localDate } from '../shared/dates.js';
import { createRoutine, getDashboard, setCompletion } from './database.js';

export function createApp(db: Database.Database, today = () => localDate()) {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '4kb' }));

  app.get('/api/dashboard', (_req, res) => {
    res.json(getDashboard(db, today()));
  });

  app.post('/api/routines', (req, res) => {
    const name: unknown = req.body?.name;
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) {
      res.status(400).json({ error: 'Enter a routine name between 1 and 80 characters.' });
      return;
    }
    const date = today();
    createRoutine(db, name.trim(), date);
    res.status(201).json(getDashboard(db, date));
  });

  app.put('/api/routines/:id/completion', (req, res) => {
    const id = Number(req.params.id);
    if (!/^\d+$/.test(req.params.id) || !Number.isSafeInteger(id) || id < 1 || typeof req.body?.completed !== 'boolean') {
      res.status(400).json({ error: 'Provide a valid routine and a boolean completed value.' });
      return;
    }
    const date = today();
    if (req.body.date !== date) {
      res.status(409).json({ error: 'Only today can be changed. Refresh the dashboard and try again.' });
      return;
    }
    if (!setCompletion(db, id, date, req.body.completed)) {
      res.status(404).json({ error: 'This routine is not active today.' });
      return;
    }
    res.json(getDashboard(db, date));
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });
  const handleError: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
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
