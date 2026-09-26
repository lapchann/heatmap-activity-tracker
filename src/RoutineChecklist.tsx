import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Routine } from '../shared/types';

interface Props {
  routines: Routine[];
  busy: boolean;
  onToggle: (id: number, completed: boolean) => void;
  onCreate: (name: string) => Promise<boolean>;
}

export function RoutineChecklist({ routines, busy, onToggle, onCreate }: Props) {
  const [name, setName] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim() && await onCreate(name.trim())) setName('');
  }

  return <section className="panel checklist" aria-labelledby="today-heading">
    <div className="section-heading">
      <h2 id="today-heading">Today’s routines</h2>
      <span className="muted">One check at a time.</span>
    </div>
    {routines.length === 0
      ? <p className="empty-state">Start with one thing that matters to you. Add your first routine below.</p>
      : <ul className="routine-list">
        {routines.map((routine) => <li key={routine.id}>
          <label className={routine.completed ? 'routine completed' : 'routine'}>
            <input type="checkbox" checked={routine.completed} disabled={busy}
              onChange={(event) => onToggle(routine.id, event.target.checked)} />
            <span>{routine.name}</span>
          </label>
        </li>)}
      </ul>}
    <form onSubmit={(event) => void submit(event)} className="add-routine">
      <label htmlFor="routine-name">New routine</label>
      <div className="input-row">
        <input id="routine-name" value={name} onChange={(event) => setName(event.target.value)}
          maxLength={80} required placeholder="e.g. Reading" disabled={busy} autoComplete="off" />
        <button className="primary-button" disabled={busy || !name.trim()} type="submit">Add routine</button>
      </div>
    </form>
  </section>;
}
