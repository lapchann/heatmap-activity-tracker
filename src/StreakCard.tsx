import { useState } from 'react';
import { isCalendarDate, previousDate } from '../shared/dates';
import type { StreakRoutine } from '../shared/types';

interface Props {
  routine: StreakRoutine;
  today: string;
  busy: boolean;
  onToggle: (id: number, date: string, completed: boolean, todayOnly?: boolean) => void;
}

export function StreakCard({ routine, today, busy, onToggle }: Props) {
  const [date, setDate] = useState(() => previousDate(today));
  const validDate = isCalendarDate(date) && date <= today;
  return <section className="panel streak-card" aria-labelledby={`streak-${routine.id}`} style={{ borderTopColor: routine.accentColor }}>
    <h3 id={`streak-${routine.id}`}><span aria-hidden="true">{routine.symbol}</span> {routine.name}</h3>
    <p className="streak-count"><strong>{routine.streak}</strong> {routine.streak === 1 ? 'day' : 'days'}</p>
    <label className="routine">
      <input type="checkbox" checked={routine.completed} disabled={busy} onChange={(event) => onToggle(routine.id, today, event.target.checked, true)} />
      <span>Done today</span>
    </label>
    <details className="streak-history">
      <summary>Correct history</summary>
      <label htmlFor={`history-${routine.id}`}>Date</label>
      <input id={`history-${routine.id}`} type="date" min="1000-01-01" max={today} value={date} disabled={busy} onChange={(event) => setDate(event.target.value)} />
      {!validDate && <p className="field-help">Choose today or a past date.</p>}
      <label className="routine">
        <input type="checkbox" checked={validDate && routine.completionDates.includes(date)} disabled={busy || !validDate}
          onChange={(event) => onToggle(routine.id, date, event.target.checked)} />
        <span>Completed on {date || 'selected date'}</span>
      </label>
    </details>
  </section>;
}
