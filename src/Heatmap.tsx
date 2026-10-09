import { useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { calendarDate, completionLevel } from '../shared/dates';
import type { DayActivity } from '../shared/types';

interface Props { year: number; today: string; days: DayActivity[]; onEdit: (date: string) => void }

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function describeDay(day: DayActivity, today: string): string {
  const date = calendarDate(day.date).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  const activity = day.date > today ? 'Future date'
    : `${day.count} completed`;
  return `${date} — ${activity}`;
}

export function Heatmap({ year, today, days, onEdit }: Props) {
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const [focusedDate, setFocusedDate] = useState<string | null>(null);
  const [tabDate, setTabDate] = useState(today);
  const offset = calendarDate(`${year}-01-01`).getDay();
  const weeks = Math.ceil((offset + days.length) / 7);
  const activeDate = hoveredDate ?? focusedDate ?? today;
  const selectedDay = days.find((day) => day.date === activeDate) ?? days[0];
  const symbols = selectedDay.completedRoutines.filter((routine) => routine.symbol);

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const delta: Record<string, number> = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 };
    const movement = delta[event.key];
    if (movement === undefined) return;
    event.preventDefault();
    const nextIndex = Math.max(0, Math.min(days.length - 1, index + movement));
    const next = event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-date="${days[nextIndex].date}"]`);
    next?.focus();
  }

  return <section className="panel heatmap" aria-label={`${year} heatmap`}>
    <h2 className="year-label">{year}</h2>
    <div className="heatmap-scroll">
      <div className="calendar" style={{ '--weeks': weeks } as CSSProperties}>
        <div className="months" aria-hidden="true">
          {months.map((month, index) => {
            const firstDay = days.findIndex((day) => day.date === `${year}-${String(index + 1).padStart(2, '0')}-01`);
            return <span key={month} style={{ gridColumn: Math.floor((offset + firstDay) / 7) + 1 }}>{month}</span>;
          })}
        </div>
        <div className="weekdays" aria-hidden="true"><span>Mon</span><span>Wed</span><span>Fri</span></div>
        <div className="day-grid" role="group" aria-label={`${year} routine completion calendar. Use arrow keys to explore dates.`}>
          {Array.from({ length: offset }, (_, i) => <span key={`blank-${i}`} aria-hidden="true" />)}
          {days.map((day, index) => <button key={day.date} type="button"
            className={`day-cell level-${completionLevel(day.count)}${day.date > today ? ' future' : ''}${day.date === today ? ' is-today' : ''}`}
            data-date={day.date} aria-label={describeDay(day, today)} aria-current={day.date === today ? 'date' : undefined}
            tabIndex={day.date === tabDate ? 0 : -1} aria-describedby={day.date === activeDate ? 'heatmap-details' : undefined}
            onMouseEnter={() => setHoveredDate(day.date)} onMouseLeave={() => setHoveredDate(null)}
            onFocus={() => { setHoveredDate(null); setFocusedDate(day.date); setTabDate(day.date); }} onBlur={() => setFocusedDate(null)}
            onKeyDown={(event) => moveFocus(event, index)}
            aria-disabled={day.date > today} onClick={() => { if (day.date <= today) onEdit(day.date); }}
          />)}
        </div>
      </div>
    </div>
    <div className="heatmap-footer">
      <div id="heatmap-details" className="day-description" aria-live="polite">
        <p>{describeDay(selectedDay, today)}</p>
        {symbols.length > 0 && <div className="day-symbols">{symbols.map((routine) => <span key={routine.id}>{routine.symbol}</span>)}</div>}
      </div>
      <div className="legend" aria-label="Heatmap completions: 0, 1, 2, 3, 4 or more">
        {[0, 1, 2, 3, 4].map((level) => <span key={level} className="legend-step"><i className={`legend-cell level-${level}`} />{level === 4 ? '4+' : level}</span>)}
      </div>
    </div>
  </section>;
}
