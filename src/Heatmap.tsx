import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { calendarDate, completionLevel } from '../shared/dates';
import type { DayActivity } from '../shared/types';

interface CalendarProps { year: number; today: string; days: DayActivity[]; onEdit: (date: string) => void }
interface Props extends CalendarProps { firstYear: number; busy: boolean; onYearChange: (year: number) => void }

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function describeDay(day: DayActivity): string {
  const date = calendarDate(day.date).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  return `${date} — ${day.count} completed`;
}

function DayTooltip({ anchor, id, children, onDismiss }: { anchor: HTMLButtonElement; id: string; children: ReactNode; onDismiss: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const tooltip = ref.current!;
    const scroller = anchor.closest('.heatmap-scroll')!;
    function position() {
      const cell = anchor.getBoundingClientRect();
      const clip = scroller.getBoundingClientRect();
      const { width, height } = tooltip.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = document.documentElement.clientHeight;
      const gap = 8;
      const left = Math.max(gap, Math.min(cell.left + (cell.width - width) / 2, viewportWidth - width - gap));
      const top = cell.top - height - gap >= gap ? cell.top - height - gap : cell.bottom + gap;
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${Math.max(gap, Math.min(top, viewportHeight - height - gap))}px`;
      tooltip.style.visibility = cell.right <= Math.max(0, clip.left) || cell.left >= Math.min(viewportWidth, clip.right)
        || cell.bottom <= Math.max(0, clip.top) || cell.top >= Math.min(viewportHeight, clip.bottom) ? 'hidden' : 'visible';
    }
    function dismiss(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') onDismiss();
    }
    // Measure before paint; the portal escapes the calendar's scroll clipping and containment.
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    window.addEventListener('keydown', dismiss);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      window.removeEventListener('keydown', dismiss);
    };
  }, [anchor, children, onDismiss]);

  return createPortal(<div ref={ref} id={id} role="tooltip" className="heatmap-tooltip">{children}</div>, document.body);
}

export function Heatmap({ firstYear, busy, onYearChange, ...calendar }: Props) {
  const currentYear = Number(calendar.today.slice(0, 4));
  const years = Array.from({ length: currentYear - firstYear + 1 }, (_, index) => currentYear - index);
  return <section className="panel heatmap" aria-label={`${calendar.year} heatmap`} aria-busy={busy}>
    <div className="heatmap-layout">
      <Calendar key={calendar.year} {...calendar} />
      <nav className="year-selector" aria-label="Heatmap year">
        {years.map((year) => <button key={year} type="button" aria-pressed={year === calendar.year}
          aria-controls="heatmap-calendar" aria-disabled={busy}
          onClick={() => { if (!busy && year !== calendar.year) onYearChange(year); }}>{year}</button>)}
      </nav>
    </div>
  </section>;
}

function Calendar({ year, today, days, onEdit }: CalendarProps) {
  const [hoveredCell, setHoveredCell] = useState<HTMLButtonElement | null>(null);
  const [focusedCell, setFocusedCell] = useState<HTMLButtonElement | null>(null);
  const [tooltipDismissed, setTooltipDismissed] = useState(false);
  const tooltipId = useId();
  const [tabDate, setTabDate] = useState(() => days.some((day) => day.date === today) ? today : days[0].date);
  const offset = calendarDate(`${year}-01-01`).getDay();
  const weeks = Math.ceil((offset + days.length) / 7);
  const activeCell = hoveredCell ?? focusedCell;
  const activeDate = activeCell?.dataset.date ?? today;
  const selectedDay = days.find((day) => day.date === activeDate) ?? days[0];
  const symbols = selectedDay.completedRoutines.filter((routine) => routine.symbol);
  const symbolLine = symbols.length > 0 && <div className="day-symbols">{symbols.map((routine) => <span key={routine.id}>{routine.symbol}</span>)}</div>;
  const showTooltip = activeCell && !tooltipDismissed;

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const delta: Record<string, number> = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 };
    const movement = delta[event.key];
    if (movement === undefined) return;
    event.preventDefault();
    const nextIndex = Math.max(0, Math.min(days.length - 1, index + movement));
    const next = event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-date="${days[nextIndex].date}"]`);
    next?.focus();
  }

  return <div id="heatmap-calendar" className="heatmap-content">
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
            data-date={day.date} aria-label={describeDay(day)} aria-current={day.date === today ? 'date' : undefined}
            tabIndex={day.date === tabDate ? 0 : -1} aria-describedby={day.date === activeDate && showTooltip ? tooltipId : undefined}
            onMouseEnter={(event) => { setHoveredCell(event.currentTarget); setTooltipDismissed(false); }} onMouseLeave={() => setHoveredCell(null)}
            onFocus={(event) => { setHoveredCell(null); setFocusedCell(event.currentTarget); setTabDate(day.date); setTooltipDismissed(false); }} onBlur={() => setFocusedCell(null)}
            onKeyDown={(event) => moveFocus(event, index)}
            aria-disabled={day.date > today} onClick={() => { if (day.date <= today) { setHoveredCell(null); setTooltipDismissed(true); onEdit(day.date); } }}
          />)}
        </div>
      </div>
    </div>
    <div className="heatmap-footer">
      <div className="legend" role="img" aria-label="Heatmap completion intensity from less to more">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((level) => <i key={level} className={`legend-cell level-${level}`} aria-hidden="true" />)}
        <span>More</span>
      </div>
    </div>
    {showTooltip && <DayTooltip anchor={activeCell} id={tooltipId} onDismiss={() => setTooltipDismissed(true)}>
      <p>{describeDay(selectedDay)}</p>
      {symbolLine}
    </DayTooltip>}
  </div>;
}
