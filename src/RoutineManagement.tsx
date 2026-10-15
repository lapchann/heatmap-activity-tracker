import { useEffect, useRef, useState } from 'react';
import type { Routine, RoutineType } from '../shared/types';
import { SortableRoutineList } from './SortableRoutineList';
import { DeleteRoutineDialog } from './DeleteRoutineDialog';
import { keepDialogFocus } from './dialogFocus';

interface Props {
  routines: Routine[];
  busy: boolean;
  error: string | null;
  onReorder: (type: RoutineType, ids: number[]) => Promise<boolean>;
  onMutate: (path: string, method: string, body: object) => Promise<boolean>;
  onClose: () => void;
}

export function RoutineManagement({ routines, busy, error, onReorder, onMutate, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<RoutineType>('heatmap');
  const [symbol, setSymbol] = useState('');
  const [notice, setNotice] = useState('');
  const [dragging, setDragging] = useState(false);
  const [deleting, setDeleting] = useState<Routine | null>(null);
  const stillTracked = deleting !== null && routines.some((routine) => routine.id === deleting.id);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  useEffect(() => {
    // Only a confirmed dashboard response removes the routine, including recovery
    // after a lost DELETE response. A failed write leaves the confirmation open.
    if (deleting && !stillTracked) {
      setNotice(`Deleted ${deleting.name}. Recorded history is preserved.`);
      setDeleting(null);
      closeRef.current?.focus();
    }
  }, [deleting, stillTracked]);

  function close() {
    ref.current?.close();
    onClose();
  }

  async function create() {
    if (await onMutate('/api/routines', 'POST', { name: name.trim(), type, symbol })) {
      setNotice(`Added ${name.trim()} as a ${type} routine.`);
      setName('');
      setSymbol('');
    }
  }

  return <><dialog ref={ref} className="panel management" aria-labelledby="management-heading" onKeyDown={(event) => {
    if (dragging && event.key === 'Escape') event.preventDefault();
    keepDialogFocus(event);
  }} onCancel={(event) => { event.preventDefault(); close(); }}>
    <div className="section-heading">
      <h2 id="management-heading">Manage routines</h2>
      <button ref={closeRef} type="button" className="secondary-button" autoFocus onClick={close}>Close</button>
    </div>
    <p className="muted management-intro">Heatmap routines record meaningful effort. Streak routines build daily consistency.</p>
    {error && <p className="management-error" role="alert">{error}</p>}
    <form className="create-routine" onSubmit={(event) => { event.preventDefault(); void create(); }}>
      <h3>Add a routine</h3>
      <fieldset disabled={busy || dragging} className="metadata-fields">
        <label>Name<input value={name} maxLength={80} required onChange={(event) => setName(event.target.value)} placeholder="e.g. Reading" /></label>
        <div><label htmlFor="new-type">Type</label><select id="new-type" value={type} onChange={(event) => setType(event.target.value as RoutineType)}>
          <option value="heatmap">Heatmap</option><option value="streak">Streak</option>
        </select></div>
        <label className="symbol-field">Symbol<input value={symbol} maxLength={16} onChange={(event) => setSymbol(event.target.value)} /></label>
        <button type="submit" className="primary-button" disabled={!name.trim()}>Add routine</button>
      </fieldset>
      <p className="muted field-help" role="status">{notice}</p>
    </form>
    {(['heatmap', 'streak'] as const).map((routineType) => {
      const group = routines.filter((r) => r.type === routineType && r.deletedOn === null);
      return <section key={routineType} className="management-group" aria-label={`Manage ${routineType} routines`}>
        <h3>{routineType === 'heatmap' ? 'Heatmap routines' : 'Streak routines'}</h3>
        {!group.length && <p className="muted">No {routineType} routines yet.</p>}
        <SortableRoutineList routines={group} type={routineType} busy={busy} onReorder={onReorder} onDraggingChange={setDragging}>
          {(routine) => <RoutineEditor key={`${routine.id}:${routine.name}:${routine.symbol}`} routine={routine} busy={busy || dragging} onMutate={onMutate} onDelete={() => setDeleting(routine)} />}
        </SortableRoutineList>
      </section>;
    })}
  </dialog>
    {deleting && stillTracked && <DeleteRoutineDialog routine={deleting} busy={busy} error={error}
      onConfirm={() => { void onMutate(`/api/routines/${deleting.id}`, 'DELETE', {}); }} onClose={() => setDeleting(null)} />}
  </>;
}

function RoutineEditor({ routine, busy, onMutate, onDelete }: Pick<Props, 'busy' | 'onMutate'> & { routine: Routine; onDelete: () => void }) {
  const [name, setName] = useState(routine.name);
  const [symbol, setSymbol] = useState(routine.symbol);
  const changed = name.trim() !== routine.name || symbol !== routine.symbol;
  return <form className="routine-editor" onSubmit={(event) => { event.preventDefault(); void onMutate(`/api/routines/${routine.id}`, 'PUT', { name: name.trim(), symbol }); }}>
    <fieldset disabled={busy} className="metadata-fields">
      <label>Name<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} /></label>
      <label className="symbol-field">Symbol<input value={symbol} maxLength={16} onChange={(event) => setSymbol(event.target.value)} /></label>
      <button type="submit" className="secondary-button" disabled={!changed || !name.trim()}>Save changes</button>
      <button type="button" className="secondary-button delete-button" aria-label={`Delete ${routine.name}`} onClick={onDelete}>Delete</button>
    </fieldset>
  </form>;
}
