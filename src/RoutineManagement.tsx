import { useState } from 'react';
import type { Routine, RoutineType } from '../shared/types';
import { defaultRoutineColor, routineColors } from '../shared/colors';

interface Props {
  routines: Routine[];
  busy: boolean;
  error: string | null;
  onMutate: (path: string, method: string, body: object) => Promise<boolean>;
}

// Shared fields keep creation and customization consistent without an icon dependency.
function AppearanceFields({ id, color, symbol, onColor, onSymbol }: {
  id: string; color: string; symbol: string; onColor: (value: string) => void; onSymbol: (value: string) => void;
}) {
  return <>
    <div><label htmlFor={`${id}-accent`}>Accent</label><select id={`${id}-accent`} value={color} onChange={(event) => onColor(event.target.value)}>
      {routineColors.map((color) => <option key={color.value} value={color.value}>{color.name}</option>)}
    </select></div>
    <label className="symbol-field">Symbol<input value={symbol} required maxLength={16} onChange={(event) => onSymbol(event.target.value)} placeholder="e.g. 📚" /></label>
  </>;
}

export function RoutineManagement({ routines, busy, error, onMutate }: Props) {
  const [name, setName] = useState('');
  const [type, setType] = useState<RoutineType>('heatmap');
  const [color, setColor] = useState<string>(defaultRoutineColor);
  const [symbol, setSymbol] = useState('●');
  const [notice, setNotice] = useState('');

  async function create() {
    if (await onMutate('/api/routines', 'POST', { name: name.trim(), type, accentColor: color, symbol })) {
      setNotice(`Added ${name.trim()} as a ${type} routine.`);
      setName('');
    }
  }

  function move(group: Routine[], index: number, direction: number) {
    const ids = group.map((r) => r.id);
    [ids[index], ids[index + direction]] = [ids[index + direction], ids[index]];
    void onMutate('/api/routines/order', 'PUT', { type: group[index].type, ids });
  }

  return <details className="panel management">
    <summary>Manage routines <span className="muted">({routines.length})</span></summary>
    <p className="muted management-intro">Heatmap routines record meaningful effort. Streak routines build daily consistency. Each routine belongs to one type.</p>
    {error && <p className="management-error">{error}</p>}
    <form className="create-routine" onSubmit={(event) => { event.preventDefault(); void create(); }}>
      <h3>Add a routine</h3>
      <fieldset disabled={busy} className="metadata-fields">
        <label>Name<input value={name} maxLength={80} required onChange={(event) => setName(event.target.value)} placeholder="e.g. Reading" /></label>
        <div><label htmlFor="new-type">Type</label><select id="new-type" value={type} onChange={(event) => setType(event.target.value as RoutineType)}>
          <option value="heatmap">Heatmap</option><option value="streak">Streak</option>
        </select></div>
        <AppearanceFields id="new" color={color} symbol={symbol} onColor={setColor} onSymbol={setSymbol} />
        <button type="submit" className="primary-button" disabled={!name.trim() || !symbol}>Add routine</button>
      </fieldset>
      <p className="muted field-help">Use one emoji or symbol. Type is fixed after creation.</p>
      <p className="muted field-help" role="status">{notice}</p>
    </form>
    {(['heatmap', 'streak'] as const).map((routineType) => {
      const group = routines.filter((r) => r.type === routineType);
      return <section key={routineType} className="management-group" aria-label={`Manage ${routineType} routines`}>
        <h3>{routineType === 'heatmap' ? 'Heatmap routines' : 'Streak routines'}</h3>
        {!group.length && <p className="muted">No {routineType} routines yet.</p>}
        <ul className="management-list">{group.map((routine, index) => <li key={routine.id}>
          <div className="management-heading">
            <h4><span className="accent-dot" style={{ backgroundColor: routine.accentColor }} aria-hidden="true" />{routine.symbol} {routine.name}</h4>
            <div className="order-buttons">
              <button type="button" className="secondary-button" aria-label={`Move ${routine.name} up`} disabled={busy || index === 0} onClick={() => move(group, index, -1)}>↑</button>
              <button type="button" className="secondary-button" aria-label={`Move ${routine.name} down`} disabled={busy || index === group.length - 1} onClick={() => move(group, index, 1)}>↓</button>
            </div>
          </div>
          <RoutineEditor key={`${routine.id}:${routine.name}:${routine.accentColor}:${routine.symbol}`} routine={routine} busy={busy} onMutate={onMutate} />
        </li>)}</ul>
      </section>;
    })}
  </details>;
}

function RoutineEditor({ routine, busy, onMutate }: Pick<Props, 'busy' | 'onMutate'> & { routine: Routine }) {
  const [name, setName] = useState(routine.name);
  const [color, setColor] = useState(routine.accentColor);
  const [symbol, setSymbol] = useState(routine.symbol);
  const changed = name.trim() !== routine.name || color !== routine.accentColor || symbol !== routine.symbol;
  return <form className="routine-editor" onSubmit={(event) => { event.preventDefault(); void onMutate(`/api/routines/${routine.id}`, 'PUT', { name: name.trim(), accentColor: color, symbol }); }}>
    <fieldset disabled={busy} className="metadata-fields">
      <label>Name<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} /></label>
      <AppearanceFields id={`routine-${routine.id}`} color={color} symbol={symbol} onColor={setColor} onSymbol={setSymbol} />
      <button type="submit" className="secondary-button" disabled={!changed || !name.trim() || !symbol}>Save changes</button>
    </fieldset>
  </form>;
}
