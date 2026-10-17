# Core Routine

A local dashboard for two independent routine types: heatmap routines for meaningful effort, and streak routines for daily consistency. Use + to open Manage routines: create, rename, reorder, and optionally choose a symbol. The adjacent gear opens Settings. Close either dialog with Close or Escape; focus returns to its opening button.

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

In Manage routines, drag a row's dotted handle to reorder it within its type. Rows move aside and a dashed placeholder shows the drop position; the modal scrolls near its edges during a drag. Name and symbol fields do not initiate dragging. Keyboard users can focus a handle, press Space or Enter to pick up, use Up/Down to move, and press Space or Enter to drop. Escape cancels a drag without closing the modal; Tab also cancels. A single routine has an inactive handle.

The focused `@dnd-kit/core`, `@dnd-kit/sortable`, and `@dnd-kit/utilities` packages supply sensors, sorting, scrolling, and accessible announcements. Only a completed reorder sends one `PUT /api/routines/order` request through the existing save/recovery path. The UI updates immediately, blocks overlapping saves, and restores the last confirmed order on failure. A recovery read reconciles a write whose response was lost. Routine IDs, types, deletion markers, and completions are unchanged; no schema migration is needed.

The yearly heatmap counts only completed heatmap routines, with fixed levels for 0, 1, 2, 3, and 4+ completions. Hover/focus shows the count and completed routines' symbols. Click a past date or today (or press Enter while focused) to edit it immediately. Adding routines does not change earlier counts or levels.

Select a year inside the heatmap panel to browse or edit that calendar year. Today's checklist and streak cards always use the actual local date. Years run from the persisted first-use year through the current local year. Older schemas contain no installation or routine-creation timestamps, so existing databases use the local date of their first v4 upgrade as the boundary. Backfilled completions do not move that boundary; older activity stays stored even when its year is not selectable.

Use Appearance in Settings to choose one of six global colors and Light or Dark mode. These independent preferences save immediately through the existing SQLite settings API and survive browser refreshes and server restarts.

Each streak routine has its own card and completion control. Streaks are derived from that routine's consecutive completed local dates: count back from today if done, otherwise yesterday. An incomplete today keeps yesterday's streak until the day ends. Use Correct history on a card to toggle a past date. Future edits are rejected. Heatmap completions never affect streaks, and streak completions never affect the heatmap.

Delete in Manage routines asks for confirmation, then stops tracking that routine immediately. The routine and every recorded completion remain in SQLite, including completions made earlier on the deletion day. Heatmap counts and symbols remain visible in every eligible year. Deleted heatmap routines can still be corrected on dates before deletion; saved activity on or after deletion is read-only in the date editor. Deleted streak routines retain their history internally and reject all further completion edits. There is no restore or permanent-erasure control.

The runtime schema contains `routines` (ID, name, type, position, accent color, symbol, nullable `deleted_on`), `completions` (routine ID, date), and one `app_settings` row (first-use date, global color, appearance mode). Earlier databases upgrade automatically through transactional migrations to `user_version = 5`. IDs, completions, order, and stored routine colors are preserved. The old default ● placeholder is cleared, other symbols are retained, and new routines default to no symbol. Stored routine colors are no longer edited or displayed. Original Milestone 1 and lifecycle-era routines become ordinary heatmap routines, and the obsolete active-period table is removed. No database recreation is needed.

`GET /api/dashboard?year=2024` loads an eligible heatmap year. Mutation endpoints accept the same optional query parameter to return that year's updated dashboard; it never changes the date being edited. `PUT /api/settings` accepts `{ "color": "#2864b4", "mode": "dark" }`. Dashboard responses include the selected `year`, `firstYear`, and `appearance`. `DELETE /api/routines/:id` accepts an empty body and records the local deletion date; retries preserve the original date. Active lists exclude deleted routines, while `deletedHeatmapRoutines` supplies metadata for historical corrections.

```sh
npm run typecheck
npm test
npm run build
```

Browser interaction tests use Playwright against the production build. They create disposable databases under the OS temporary directory and start their own servers on available loopback ports, including real process restarts and injected SQLite failures. They never open `data/routines.sqlite`.

```sh
npx playwright install chromium
npm run test:browser
```

The browser suite covers pointer and keyboard ordering, scrolling lists, independent types, draft preservation, failed and lost responses, appearance persistence, native-dialog focus, and deletion confirmation at desktop and narrow viewport sizes. Screenshots and failure traces go to ignored `test-results/`.

Routine type changes, heatmap filtering, additional analytics, startup automation, and final visual polish (including the planned sizing changes) are deferred.
