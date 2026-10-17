import type { KeyboardEvent } from 'react';

export function keepDialogFocus(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== 'Tab') return;
  // A radio group has one Tab stop: its checked option. Counting unchecked
  // radios would miss the boundary and let focus leave the Settings dialog.
  const controls = event.currentTarget.querySelectorAll<HTMLElement>(
    'button:enabled, input:enabled:not([type="radio"]), input[type="radio"]:enabled:checked, select:enabled',
  );
  const first = controls[0];
  const last = controls[controls.length - 1];
  if ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
    event.preventDefault();
    (event.shiftKey ? last : first)?.focus();
  }
}
