import { useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { calendarDate, completionLevel } from '../shared/dates';
import type { DayActivity } from '../shared/types';

interface Props { year: number; today: string; days: DayActivity[] }

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function describeDay(day: DayActivity, today: string): string {
  const date = calendarDate(day.date).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  const activity = day.date > today ? 'Future date'
    : day.active === 0 ? 'No active routines'
    : `${day.completed} of ${day.active} routines completed`;
  return `${date} — ${activity}`;
}

export function Heatmap({ year, today, days }: Props) {
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const [focusedDate, setFocusedDate] = useState<string | null>(null);
  const [tabDate, setTabDate] = useState(today);
  const offset = calendarDate(`${year}-01-01`).getDay();
  const weeks = Math.ceil((offset + days.length) / 7);
  const activeDate = hoveredDate ?? focusedDate ?? today;
  const selectedDay = days.find((day) => day.date === activeDate) ?? days[0];
  const description = describeDay(selectedDay, today);

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const delta: Record<string, number> = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 };
    const movement = delta[event.key];
    if (movement === undefined) return;
    event.preventDefault();
    const nextIndex = Math.max(0, Math.min(days.length - 1, index + movement));
    const next = event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-date="${days[nextIndex].date}"]`);
    next?.focus();
  }

  return <section className="panel heatmap" aria-labelledby="heatmap-heading">
    <div className="section-heading">
      <div><h2 id="heatmap-heading">Your year, one day at a time</h2><p className="muted">A little progress adds up.</p></div>
      <span className="year-label">{year}</span>
    </div>
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
            className={`day-cell level-${completionLevel(day.completed, day.active)}${day.active === 0 ? ' inactive' : ''}${day.date > today ? ' future' : ''}${day.date === today ? ' is-today' : ''}`}
            data-date={day.date} aria-label={describeDay(day, today)} aria-current={day.date === today ? 'date' : undefined}
            tabIndex={day.date === tabDate ? 0 : -1} title={describeDay(day, today)}
            onMouseEnter={() => setHoveredDate(day.date)} onMouseLeave={() => setHoveredDate(null)}
            onFocus={() => { setFocusedDate(day.date); setTabDate(day.date); }} onBlur={() => setFocusedDate(null)}
            onKeyDown={(event) => moveFocus(event, index)}
          />)}
        </div>
      </div>
    </div>
    <div className="heatmap-footer">
      <p className="day-description" aria-live="polite">{description}</p>
      <div className="legend" aria-label="Completion scale: empty, 1 to 33 percent, 34 to 66 percent, 67 to 99 percent, 100 percent">
        <span>Less</span>{[0, 1, 2, 3, 4].map((level) => <i key={level} className={`legend-cell level-${level}`} />)}<span>More</span>
      </div>
    </div>
    <p className="heatmap-note muted">Outlined days have no active routines. Use the arrow keys to explore the calendar.</p>
  </section>;
}
