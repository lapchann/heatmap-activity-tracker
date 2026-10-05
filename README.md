# Core Routine

A local dashboard for two independent routine types: heatmap routines for meaningful effort, and streak routines for daily consistency. Create, rename, reorder, recolor, and choose a symbol in Manage routines.

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

The host PC's local calendar date determines “today.” A completion row means done; absence means not done, with at most one row per routine/date. Type is selected on creation and fixed afterward. Ordering is saved separately within each type.

The yearly heatmap counts only completed heatmap routines, with fixed levels for 0, 1, 2, 3, and 4+ completions. Hover/focus shows the count and completed routines' symbols. Click a past date or today (or press Enter while focused) to edit it immediately. Adding routines does not change earlier counts or levels.

Each streak routine has its own card and completion control. Streaks are derived from that routine's consecutive completed local dates: count back from today if done, otherwise yesterday. An incomplete today keeps yesterday's streak until the day ends. Use Correct history on a card to toggle a past date. Future edits are rejected. Heatmap completions never affect streaks, and streak completions never affect the heatmap.

The runtime schema has only `routines` (ID, name, type, position, accent color, symbol) and `completions` (routine ID, date). Original Milestone 1 databases and the temporary lifecycle development schema upgrade transactionally to `user_version = 2`. Migration preserves all routine IDs and completion rows, plus existing order/colors, defaults old routines to heatmap with a ● symbol, and drops the obsolete active-period table. Previously archived/scheduled routines become ordinary heatmap routines; their preserved completions now count without period restrictions. No database recreation is needed.

```sh
npm run typecheck
npm test
npm run build
```

Routine type changes, remove/hide controls, heatmap filtering, additional analytics, startup automation, and final visual polish are deferred.
