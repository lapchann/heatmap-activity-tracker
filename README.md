# Core Routine

A local routine checklist and calendar heatmap. Milestone 1 supports creating routines and checking/unchecking today, backed by SQLite.

Requires Node.js 22.12+ and npm.

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5173. Vite proxies API requests to Express on port 3001.

For a production build with **one application process**:

```sh
npm run build
npm start
```

Open http://127.0.0.1:3001. Run commands from the repository root. The server binds to loopback only.

The database initializes automatically at `data/routines.sqlite`; it and its WAL/SHM files are ignored by Git. Override with `DATABASE_PATH=/path/to/routines.sqlite`. `PORT` overrides the Express port for production (the development proxy expects 3001).

The host PC's local calendar date determines “today.” New routines become active that day; earlier days with no active routines are neutral. Completions are rows that exist only when checked. Active periods use inclusive start and exclusive end dates, leaving room for future archive/reactivation support.

```sh
npm run typecheck
npm test
npm run build
```

Historical editing, lifecycle controls, additional statistics, startup automation, and final visual polish are deferred.
