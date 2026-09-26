import express from 'express';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { openDatabase } from './database.js';

const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.');
const db = openDatabase(process.env.DATABASE_PATH ?? 'data/routines.sqlite');
const app = createApp(db);
app.use(express.static(resolve(import.meta.dirname, '../client')));
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`Core Routine is running at http://127.0.0.1:${port}`);
});
server.on('error', (error) => {
  console.error('Unable to start server:', error);
  db.close();
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => server.close(() => {
    db.close();
    process.exit(0);
  }));
}
