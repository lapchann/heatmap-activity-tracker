# Core Routine

A local dashboard for two independent routine types: heatmap routines for meaningful effort, and streak routines for daily consistency. Use + to open Manage routines: create, rename, reorder, and optionally choose a symbol. Close the dialog with Close or Escape.

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

Select a year inside the heatmap panel to browse or edit that calendar year. Today's checklist and streak cards always use the actual local date. Years run from the persisted first-use year through the current local year. Older schemas contain no installation or routine-creation timestamps, so existing databases use the local date of their first v4 upgrade as the boundary. Backfilled completions do not move that boundary; older activity stays stored even when its year is not selectable.

Use Appearance in Manage routines to choose one of six global colors and Light or Dark mode. These independent preferences save immediately in SQLite and survive browser refreshes and server restarts.

Each streak routine has its own card and completion control. Streaks are derived from that routine's consecutive completed local dates: count back from today if done, otherwise yesterday. An incomplete today keeps yesterday's streak until the day ends. Use Correct history on a card to toggle a past date. Future edits are rejected. Heatmap completions never affect streaks, and streak completions never affect the heatmap.

Delete in Manage routines asks for confirmation, then stops tracking that routine immediately. The routine and every recorded completion remain in SQLite, including completions made earlier on the deletion day. Heatmap counts and symbols remain visible in every eligible year. Deleted heatmap routines can still be corrected on dates before deletion; saved activity on or after deletion is read-only in the date editor. Deleted streak routines retain their history internally and reject all further completion edits. There is no restore or permanent-erasure control.

The runtime schema contains `routines` (ID, name, type, position, accent color, symbol, nullable `deleted_on`), `completions` (routine ID, date), and one `app_settings` row (first-use date, global color, appearance mode). Earlier databases upgrade automatically through transactional migrations to `user_version = 5`. IDs, completions, order, and stored routine colors are preserved. The old default ● placeholder is cleared, other symbols are retained, and new routines default to no symbol. Stored routine colors are no longer edited or displayed. Original Milestone 1 and lifecycle-era routines become ordinary heatmap routines, and the obsolete active-period table is removed. No database recreation is needed.

`GET /api/dashboard?year=2024` loads an eligible heatmap year. Mutation endpoints accept the same optional query parameter to return that year's updated dashboard; it never changes the date being edited. `PUT /api/settings` accepts `{ "color": "#2864b4", "mode": "dark" }`. Dashboard responses include the selected `year`, `firstYear`, and `appearance`. `DELETE /api/routines/:id` accepts an empty body and records the local deletion date; retries preserve the original date. Active lists exclude deleted routines, while `deletedHeatmapRoutines` supplies metadata for historical corrections.

```sh
npm run typecheck
npm test
npm run build
```

Routine type changes, drag-and-drop ordering, heatmap filtering, additional analytics, startup automation, and final visual polish are deferred.
