import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { Appearance } from '../shared/types';
import { themeColors } from '../shared/colors';
import { keepDialogFocus } from './dialogFocus';

interface Props {
  appearance: Appearance;
  busy: boolean;
  error: string | null;
  onAppearanceChange: (appearance: Appearance) => void;
  onClose: () => void;
}

export function SettingsDialog({ appearance, busy, error, onAppearanceChange, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  function close() {
    ref.current?.close();
    onClose();
  }

  return <dialog ref={ref} className="panel settings-dialog" aria-labelledby="settings-heading"
    onKeyDown={keepDialogFocus}
    onCancel={(event) => { event.preventDefault(); close(); }}>
    <div className="section-heading">
      <h2 id="settings-heading">Settings</h2>
      <button type="button" className="secondary-button" autoFocus onClick={close}>Close</button>
    </div>
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
      <p className="muted settings-status" role="status">{busy ? 'Saving…' : 'Changes save automatically.'}</p>
    </section>
  </dialog>;
}
