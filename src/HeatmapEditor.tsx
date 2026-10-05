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
    <RoutineChecklist routines={routines} busy={busy} onToggle={onToggle} />
  </dialog>;
}
