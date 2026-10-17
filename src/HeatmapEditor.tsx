import { useEffect, useRef } from 'react';
import { calendarDate } from '../shared/dates';
import type { HeatmapRoutine } from '../shared/types';
import { RoutineChecklist } from './RoutineChecklist';

interface Props {
  date: string;
  routines: HeatmapRoutine[];
  busy: boolean;
  error: string | null;
  onToggle: (id: number, completed: boolean) => void;
  onClose: () => void;
}

export function HeatmapEditor({ date, routines, busy, error, onToggle, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const editable = routines.filter((routine) => routine.deletedOn === null || date < routine.deletedOn);
  const retained = routines.filter((routine) => routine.deletedOn !== null && date >= routine.deletedOn && routine.completed);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  function close() {
    // Close while still mounted so the browser restores focus to the date square.
    ref.current?.close();
    onClose();
  }
  return <dialog ref={ref} className="panel date-editor" aria-labelledby="edit-date-heading" onCancel={(event) => { event.preventDefault(); close(); }}>
    <div className="section-heading">
      <h2 id="edit-date-heading">{calendarDate(date).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</h2>
      <button type="button" className="secondary-button" onClick={close}>Close</button>
    </div>
    <p className="muted">Heatmap routines · Changes save immediately.</p>
    {error && <p className="management-error" role="alert">{error}</p>}
    {editable.length > 0 && <RoutineChecklist routines={editable} busy={busy} onToggle={onToggle} />}
    {!editable.length && !retained.length && <p className="empty-state">No heatmap routines to edit for this date.</p>}
    {retained.length > 0 && <section className="retained-completions" aria-labelledby="retained-heading">
      <h3 id="retained-heading">Recorded completions</h3>
      <p className="muted">These routines were deleted. Their saved completions are read-only.</p>
      <ul className="routine-list">{retained.map((routine) => <li key={routine.id} className="routine completed">
        <span aria-hidden="true">✓</span>
        {routine.symbol && <span className="routine-symbol" aria-hidden="true">{routine.symbol}</span>}
        <span>{routine.name}</span><span className="sr-only">Completed, read-only</span>
      </li>)}</ul>
    </section>}
  </dialog>;
}
