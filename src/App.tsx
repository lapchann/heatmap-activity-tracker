import { useCallback, useEffect, useRef, useState } from 'react';
import { calendarDate } from '../shared/dates';
import type { Dashboard } from '../shared/types';
import { requestDashboard } from './api';
import { Heatmap } from './Heatmap';
import { RoutineChecklist } from './RoutineChecklist';

export function App() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      setDashboard(await requestDashboard());
      setError(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not load your routines.');
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

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
      setDashboard(await requestDashboard(path, { method, body: JSON.stringify(body) }));
      return true;
    } catch (error) {
      setDashboard(previous);
      // A response can be lost after a successful write. Re-read before reporting failure.
      try { setDashboard(await requestDashboard()); } catch { /* Keep the last confirmed snapshot. */ }
      setError(error instanceof Error ? error.message : 'Could not save this change. Please try again.');
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function toggle(id: number, completed: boolean) {
    if (!dashboard) return;
    const routines = dashboard.routines.map((routine) => routine.id === id ? { ...routine, completed } : routine);
    const count = routines.filter((routine) => routine.completed).length;
    const optimistic = { ...dashboard, routines, days: dashboard.days.map((day) => day.date === dashboard.today ? { ...day, completed: count } : day) };
    void mutate(`/api/routines/${id}/completion`, 'PUT', { date: dashboard.today, completed }, optimistic);
  }

  const completed = dashboard?.routines.filter((routine) => routine.completed).length ?? 0;
  return <main>
    <header className="page-header">
      <div><p className="eyebrow">Small actions. Steady progress.</p><h1>Core Routine</h1></div>
      {dashboard && <time dateTime={dashboard.today}>{calendarDate(dashboard.today).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</time>}
    </header>
    {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => void refresh()} disabled={busy || loading}>Retry loading</button></div>}
    {!dashboard && <p role="status" className="panel">{loading ? 'Loading your routines…' : 'Your dashboard is unavailable. Retry loading to reconnect.'}</p>}
    {dashboard && <>
      <Heatmap key={dashboard.year} year={dashboard.year} today={dashboard.today} days={dashboard.days} />
      <div className="today-layout">
        <RoutineChecklist routines={dashboard.routines} busy={busy || loading} onToggle={toggle}
          onCreate={(name) => mutate('/api/routines', 'POST', { name })} />
        <section className="panel today-summary" aria-labelledby="summary-heading">
          <h2 id="summary-heading">Today</h2>
          <p className="today-count">{completed}<span> / {dashboard.routines.length}</span></p>
          <p className="muted">{dashboard.routines.length === 0 ? 'Your first routine starts here.' : 'routines completed'}</p>
          {dashboard.routines.length > 0 && <progress aria-label="Today's completion" value={completed} max={dashboard.routines.length} />}
          <p className="save-status" role="status">{busy ? 'Saving…' : loading ? 'Refreshing…' : error ? 'Check the message above.' : 'Up to date'}</p>
        </section>
      </div>
    </>}
  </main>;
}
