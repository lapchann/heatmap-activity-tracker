import { useEffect, useRef, useState } from 'react';
import type { Routine } from '../shared/types';

interface Props {
  routine: Routine;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

export function DeleteRoutineDialog({ routine, busy, error, onConfirm, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [attempted, setAttempted] = useState(false);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  function cancel() {
    if (busy) return;
    ref.current?.close();
    onClose();
  }

  return <dialog ref={ref} className="panel delete-confirmation" role="alertdialog"
    aria-labelledby="delete-routine-heading" aria-describedby="delete-routine-description" aria-busy={busy}
    onCancel={(event) => { event.preventDefault(); cancel(); }}
    onKeyDown={(event) => {
      if (event.key !== 'Tab') return;
      event.preventDefault();
      (document.activeElement === cancelRef.current ? confirmRef : cancelRef).current?.focus();
    }}>
    <h2 id="delete-routine-heading">Delete “{routine.name}”?</h2>
    <p id="delete-routine-description">This removes {routine.name} from your daily routine tracking. Previously recorded completions and heatmap activity will be preserved.</p>
    {attempted && error && <p className="management-error" role="alert">{error}</p>}
    <div className="confirmation-actions">
      <button ref={cancelRef} type="button" className="secondary-button" autoFocus aria-disabled={busy} onClick={cancel}>Cancel</button>
      <button ref={confirmRef} type="button" className="secondary-button delete-button confirm-delete" aria-disabled={busy}
        onClick={() => { if (!busy) { setAttempted(true); onConfirm(); } }}>{busy ? 'Deleting…' : 'Delete routine'}</button>
    </div>
  </dialog>;
}
