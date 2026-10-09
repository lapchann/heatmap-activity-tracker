import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import type { Appearance, Routine, RoutineType } from '../shared/types';
import { themeColors } from '../shared/colors';

interface Props {
  routines: Routine[];
  busy: boolean;
  error: string | null;
  appearance: Appearance;
  onAppearanceChange: (appearance: Appearance) => void;
  onMutate: (path: string, method: string, body: object) => Promise<boolean>;
  onClose: () => void;
}

export function RoutineManagement({ routines, busy, error, appearance, onAppearanceChange, onMutate, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<RoutineType>('heatmap');
  const [symbol, setSymbol] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  function close() {
    ref.current?.close();
    onClose();
  }

  function keepFocus(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Tab') return;
    const controls = event.currentTarget.querySelectorAll<HTMLElement>('button:enabled, input:enabled, select:enabled');
    const first = controls[0];
    const last = controls[controls.length - 1];
    if ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    }
  }

  async function create() {
    if (await onMutate('/api/routines', 'POST', { name: name.trim(), type, symbol })) {
      setNotice(`Added ${name.trim()} as a ${type} routine.`);
      setName('');
      setSymbol('');
    }
  }

  function move(group: Routine[], index: number, direction: number) {
    const ids = group.map((r) => r.id);
    [ids[index], ids[index + direction]] = [ids[index + direction], ids[index]];
    void onMutate('/api/routines/order', 'PUT', { type: group[index].type, ids });
  }

  return <dialog ref={ref} className="panel management" aria-labelledby="management-heading" onKeyDown={keepFocus} onCancel={(event) => { event.preventDefault(); close(); }}>
    <div className="section-heading">
      <h2 id="management-heading">Manage routines</h2>
      <button type="button" className="secondary-button" onClick={close}>Close</button>
    </div>
    <p className="muted management-intro">Heatmap routines record meaningful effort. Streak routines build daily consistency.</p>
    {error && <p className="management-error" role="alert">{error}</p>}
    <section className="appearance-settings" aria-labelledby="appearance-heading">
      <h3 id="appearance-heading">Appearance</h3>
      <div className="appearance-controls">
        <label>Mode<select value={appearance.mode} aria-disabled={busy}
          onChange={(event) => { if (!busy) onAppearanceChange({ ...appearance, mode: event.target.value as Appearance['mode'] }); }}>
          <option value="light">Light</option><option value="dark">Dark</option>
        </select></label>
        <fieldset className="theme-colors" aria-disabled={busy}>
          <legend>Color</legend>
          {themeColors.map((color) => <label key={color.value} title={color.name}>
            <input type="radio" name="theme-color" value={color.value} checked={appearance.color === color.value} aria-disabled={busy}
              onChange={() => { if (!busy) onAppearanceChange({ ...appearance, color: color.value }); }} />
            <span className="theme-swatch" style={{ '--swatch': color.value } as CSSProperties} aria-hidden="true" />
            <span className="sr-only">{color.name}</span>
          </label>)}
        </fieldset>
      </div>
    </section>
    <form className="create-routine" onSubmit={(event) => { event.preventDefault(); void create(); }}>
      <h3>Add a routine</h3>
      <fieldset disabled={busy} className="metadata-fields">
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
      const group = routines.filter((r) => r.type === routineType);
      return <section key={routineType} className="management-group" aria-label={`Manage ${routineType} routines`}>
        <h3>{routineType === 'heatmap' ? 'Heatmap routines' : 'Streak routines'}</h3>
        {!group.length && <p className="muted">No {routineType} routines yet.</p>}
        <ul className="management-list">{group.map((routine, index) => <li key={routine.id}>
          <div className="management-heading">
            <h4>{routine.symbol && <span className="routine-symbol" aria-hidden="true">{routine.symbol}</span>}{routine.name}</h4>
            <div className="order-buttons">
              <button type="button" className="secondary-button" aria-label={`Move ${routine.name} up`} disabled={busy || index === 0} onClick={() => move(group, index, -1)}>↑</button>
              <button type="button" className="secondary-button" aria-label={`Move ${routine.name} down`} disabled={busy || index === group.length - 1} onClick={() => move(group, index, 1)}>↓</button>
            </div>
          </div>
          <RoutineEditor key={`${routine.id}:${routine.name}:${routine.symbol}`} routine={routine} busy={busy} onMutate={onMutate} />
        </li>)}</ul>
      </section>;
    })}
  </dialog>;
}

function RoutineEditor({ routine, busy, onMutate }: Pick<Props, 'busy' | 'onMutate'> & { routine: Routine }) {
  const [name, setName] = useState(routine.name);
  const [symbol, setSymbol] = useState(routine.symbol);
  const changed = name.trim() !== routine.name || symbol !== routine.symbol;
  return <form className="routine-editor" onSubmit={(event) => { event.preventDefault(); void onMutate(`/api/routines/${routine.id}`, 'PUT', { name: name.trim(), symbol }); }}>
    <fieldset disabled={busy} className="metadata-fields">
      <label>Name<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} /></label>
      <label className="symbol-field">Symbol<input value={symbol} maxLength={16} onChange={(event) => setSymbol(event.target.value)} /></label>
      <button type="submit" className="secondary-button" disabled={!changed || !name.trim()}>Save changes</button>
    </fieldset>
  </form>;
}
