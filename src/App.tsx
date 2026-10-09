import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { calendarDate, currentStreak } from '../shared/dates';
import type { Appearance, Dashboard } from '../shared/types';
import { requestDashboard } from './api';
import { Heatmap } from './Heatmap';
import { RoutineChecklist } from './RoutineChecklist';
import { RoutineManagement } from './RoutineManagement';
import { StreakCard } from './StreakCard';
import { HeatmapEditor } from './HeatmapEditor';

export function App() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const inFlight = useRef(false);
  // Undefined follows the current year as the local calendar advances.
  const selectedYear = useRef<number | undefined>(undefined);
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [managingRoutines, setManagingRoutines] = useState(false);

  const refresh = useCallback(async (year = selectedYear.current) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const next = await requestDashboard('/api/dashboard', undefined, year);
      selectedYear.current = next.year === Number(next.today.slice(0, 4)) ? undefined : next.year;
      setDashboard(next);
      setError(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not load your routines.');
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  useLayoutEffect(() => {
    if (!dashboard) return;
    document.documentElement.dataset.appearance = dashboard.appearance.mode;
    document.documentElement.style.setProperty('--theme-color', dashboard.appearance.color);
  }, [dashboard?.appearance.color, dashboard?.appearance.mode]);

  useEffect(() => {
    void refresh();
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const interval = window.setInterval(onVisible, 60_000);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [refresh]);

  async function mutate(path: string, method: string, body: object, optimistic?: Dashboard): Promise<boolean> {
    if (inFlight.current) return false;
    inFlight.current = true;
    const previous = dashboard;
    setBusy(true);
    setError(null);
    if (optimistic) setDashboard(optimistic);
    try {
      setDashboard(await requestDashboard(path, { method, body: JSON.stringify(body) }, selectedYear.current));
      return true;
    } catch (error) {
      setDashboard(previous);
      // A response can be lost after a successful write. Re-read before reporting failure.
      try { setDashboard(await requestDashboard('/api/dashboard', undefined, selectedYear.current)); } catch { /* Keep the last confirmed snapshot. */ }
      setError(error instanceof Error ? error.message : 'Could not save this change. Please try again.');
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function changeAppearance(appearance: Appearance) {
    if (dashboard) void mutate('/api/settings', 'PUT', appearance, { ...dashboard, appearance });
  }

  function toggle(id: number, date: string, completed: boolean, todayOnly = false) {
    if (!dashboard) return;
    const heatmapRoutine = dashboard.heatmapRoutines.find((routine) => routine.id === id);
    const optimistic: Dashboard = { ...dashboard };
    if (heatmapRoutine) {
      optimistic.heatmapRoutines = dashboard.heatmapRoutines.map((r) => r.id === id && date === dashboard.today ? { ...r, completed } : r);
      optimistic.days = dashboard.days.map((day) => {
        if (day.date !== date) return day;
        const ids = new Set(day.completedRoutines.map((r) => r.id));
        if (completed) ids.add(id); else ids.delete(id);
        const completedRoutines = dashboard.heatmapRoutines.filter((r) => ids.has(r.id)).map(({ id, name, symbol }) => ({ id, name, symbol }));
        return { ...day, count: completedRoutines.length, completedRoutines };
      });
    } else {
      optimistic.streakRoutines = dashboard.streakRoutines.map((r) => {
        if (r.id !== id) return r;
        const dates = new Set(r.completionDates);
        if (completed) dates.add(date); else dates.delete(date);
        const completionDates = [...dates].sort();
        return { ...r, completed: date === dashboard.today ? completed : r.completed, completionDates, streak: currentStreak(completionDates, dashboard.today) };
      });
    }
    void mutate(`/api/routines/${id}/completion`, 'PUT', { date, completed, todayOnly }, optimistic);
  }

  const editingDay = dashboard?.days.find((day) => day.date === editingDate);
  return <main>
    <header className="page-header">
      <h1 className="sr-only">Routine dashboard</h1>
      {dashboard && <time dateTime={dashboard.today}>{calendarDate(dashboard.today).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</time>}
      <button type="button" className="manage-button" aria-label="Manage routines" title="Manage routines" aria-haspopup="dialog" disabled={!dashboard} onClick={() => setManagingRoutines(true)}>+</button>
    </header>
    {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => void refresh()} disabled={busy || loading}>Retry loading</button></div>}
    {!dashboard && <p role="status" className="panel">{loading ? 'Loading your routines…' : 'Your dashboard is unavailable. Retry loading to reconnect.'}</p>}
    {dashboard && <>
      <div className="dashboard-columns">
        <div className="main-column">
          <Heatmap year={dashboard.year} firstYear={dashboard.firstYear} today={dashboard.today} days={dashboard.days}
            busy={busy || loading} onYearChange={(year) => void refresh(year)}
            onEdit={(date) => { if (!busy && !loading) setEditingDate(date); }} />
          <section className="checklist" aria-labelledby="today-heading">
            <div className="section-heading"><h2 id="today-heading">Today</h2></div>
            <RoutineChecklist routines={dashboard.heatmapRoutines} busy={busy || loading} onToggle={(id, completed) => toggle(id, dashboard.today, completed, true)} />
          </section>
        </div>
        <aside className="streak-column" aria-labelledby="streaks-heading">
          <h2 id="streaks-heading">Daily streaks</h2>
          {!dashboard.streakRoutines.length && <p className="panel muted">Add a streak routine in Manage routines to start a daily habit.</p>}
          {dashboard.streakRoutines.map((routine) => <StreakCard key={routine.id} routine={routine} today={dashboard.today} busy={busy || loading} onToggle={toggle} />)}
        </aside>
      </div>
      <p className="sr-only" role="status">{busy ? 'Saving…' : loading ? 'Refreshing…' : error ? 'Check the message above.' : 'Up to date'}</p>
      {managingRoutines && <RoutineManagement routines={[...dashboard.heatmapRoutines, ...dashboard.streakRoutines]} busy={busy || loading} error={error}
        appearance={dashboard.appearance} onAppearanceChange={changeAppearance} onMutate={mutate} onClose={() => setManagingRoutines(false)} />}
      {editingDay && <HeatmapEditor date={editingDay.date} error={error} busy={busy || loading} onClose={() => setEditingDate(null)}
        routines={dashboard.heatmapRoutines.map((r) => ({ ...r, completed: editingDay.completedRoutines.some((c) => c.id === r.id) }))}
        onToggle={(id, completed) => toggle(id, editingDay.date, completed)} />}
    </>}
  </main>;
}
