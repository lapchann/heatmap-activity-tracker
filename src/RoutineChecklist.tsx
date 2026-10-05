import type { HeatmapRoutine } from '../shared/types';

interface Props {
  routines: HeatmapRoutine[];
  busy: boolean;
  onToggle: (id: number, completed: boolean) => void;
}

export function RoutineChecklist({ routines, busy, onToggle }: Props) {
  if (!routines.length) return <p className="empty-state">Add a heatmap routine in Manage routines below.</p>;
  return <ul className="routine-list">
    {routines.map((routine) => <li key={routine.id}>
      <label className={routine.completed ? 'routine completed' : 'routine'}>
        <input type="checkbox" checked={routine.completed} disabled={busy}
          onChange={(event) => onToggle(routine.id, event.target.checked)} />
        <span className="accent-dot" style={{ backgroundColor: routine.accentColor }} aria-hidden="true" />
        <span aria-hidden="true">{routine.symbol}</span><span>{routine.name}</span>
      </label>
    </li>)}
  </ul>;
}
