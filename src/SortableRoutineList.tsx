import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { closestCenter, DndContext, DragOverlay, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { CollisionDetection, DragEndEvent, UniqueIdentifier } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Routine, RoutineType } from '../shared/types';

interface Props {
  routines: Routine[];
  type: RoutineType;
  busy: boolean;
  onReorder: (type: RoutineType, ids: number[]) => Promise<boolean>;
  onDraggingChange: (dragging: boolean) => void;
  children: (routine: Routine) => ReactNode;
}

const instructions = 'To reorder, focus a drag handle and press Space or Enter to pick up. Use Up and Down to move. Press Space or Enter to save, or Escape to cancel.';

export function SortableRoutineList({ routines, type, busy, onReorder, onDraggingChange, children }: Props) {
  const listRef = useRef<HTMLUListElement>(null);
  const startingIds = useRef<number[]>([]);
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const [overId, setOverId] = useState<UniqueIdentifier | null>(null);
  const [notice, setNotice] = useState('');
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      // Keep each keypress aligned with the current row even during scrolling.
      scrollBehavior: 'auto',
      keyboardCodes: { start: ['Space', 'Enter'], end: ['Space', 'Enter'], cancel: ['Escape', 'Tab'] },
    }),
  );
  const active = routines.find((routine) => routine.id === activeId);
  const position = routines.findIndex((routine) => routine.id === overId) + 1;
  const nameOf = (id: UniqueIdentifier) => routines.find((routine) => routine.id === id)?.name ?? 'Routine';
  const positionOf = (id: UniqueIdentifier) => routines.findIndex((routine) => routine.id === id) + 1;

  // Separate contexts exclude the other type. Reject pointer drops outside this
  // list too, instead of closestCenter silently choosing its first/last row.
  const collisionDetection: CollisionDetection = (args) => {
    const rect = listRef.current?.getBoundingClientRect();
    const point = args.pointerCoordinates;
    if (point && rect && (point.x < rect.left || point.x > rect.right || point.y < rect.top || point.y > rect.bottom)) return [];
    return closestCenter(args);
  };

  function finish() {
    setActiveId(null);
    setOverId(null);
    onDraggingChange(false);
  }

  async function drop({ active, over }: DragEndEvent) {
    finish();
    if (!over || active.id === over.id) return;
    const ids = routines.map((routine) => routine.id);
    // A background refresh can change the tracked list during a drag. Never
    // submit a stale set of IDs or overwrite an order received during the drag.
    if (busy || ids.some((id, index) => id !== startingIds.current[index]) || ids.length !== startingIds.current.length) {
      setNotice('The list changed while dragging. Please try again.');
      return;
    }
    const from = ids.indexOf(Number(active.id));
    const to = ids.indexOf(Number(over.id));
    if (from < 0 || to < 0) return;
    setNotice('Saving order…');
    const saved = await onReorder(type, arrayMove(ids, from, to));
    setNotice(saved ? `${nameOf(active.id)} moved to position ${to + 1} of ${ids.length}. Order saved.`
      : 'Could not confirm the save. Showing the last confirmed order. Please try again.');
  }

  return <>
    {routines.length > 1 && <p className="muted reorder-help">Drag the handles to reorder. Keyboard: Space or Enter, then ↑/↓; Escape cancels.</p>}
    <DndContext sensors={sensors} collisionDetection={collisionDetection}
      accessibility={{ screenReaderInstructions: { draggable: instructions }, announcements: {
        onDragStart: ({ active }) => `Picked up ${nameOf(active.id)}, position ${positionOf(active.id)} of ${routines.length} in ${type} routines.`,
        onDragOver: ({ active, over }) => over ? `${nameOf(active.id)}, drop at position ${positionOf(over.id)} of ${routines.length}.` : 'Outside the list. Drop to cancel.',
        onDragEnd: ({ active, over }) => over ? `Dropped ${nameOf(active.id)} at position ${positionOf(over.id)}.` : 'Reordering cancelled.',
        onDragCancel: () => 'Reordering cancelled. Order unchanged.',
      } }}
      onDragStart={({ active }) => {
        startingIds.current = routines.map((routine) => routine.id);
        setActiveId(active.id);
        setOverId(active.id);
        setNotice('');
        onDraggingChange(true);
      }}
      onDragOver={({ over }) => setOverId(over?.id ?? null)}
      onDragCancel={finish} onDragEnd={(event) => { void drop(event); }}>
      <SortableContext items={routines.map((routine) => routine.id)} strategy={verticalListSortingStrategy}>
        <ul ref={listRef} className="management-list" aria-label={`${type === 'heatmap' ? 'Heatmap' : 'Streak'} routine order`}>
          {routines.map((routine) => <SortableRow key={routine.id} routine={routine} disabled={busy || routines.length < 2}>
            {children(routine)}
          </SortableRow>)}
        </ul>
      </SortableContext>
      {/* Keep the overlay in the native dialog's top layer, including while scrolling. */}
      <DragOverlay dropAnimation={null}>
        {active && <div className="routine-drag-preview" aria-hidden="true">
          <strong>{active.symbol} {active.name}</strong>
          <p>{position ? `Position ${position} of ${routines.length}` : 'Outside list · release to cancel'}</p>
        </div>}
      </DragOverlay>
    </DndContext>
    <p className="field-help reorder-status" role="status">{notice}</p>
  </>;
}

function SortableRow({ routine, disabled, children }: { routine: Routine; disabled: boolean; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: routine.id, disabled,
  });
  return <li ref={setNodeRef} className={isDragging ? 'is-dragging' : undefined}
    style={{ transform: CSS.Transform.toString(transform), transition }}>
    <div className="management-heading">
      <h4>{routine.symbol && <span className="routine-symbol" aria-hidden="true">{routine.symbol}</span>}{routine.name}</h4>
      <button ref={setActivatorNodeRef} type="button" className="secondary-button drag-handle" {...attributes} {...listeners}
        aria-label={`Reorder ${routine.name}`} aria-disabled={disabled} title={disabled ? 'Reordering unavailable' : `Drag to reorder ${routine.name}`}>
        <svg viewBox="0 0 16 24" width="16" height="24" fill="currentColor" aria-hidden="true">
          {[6, 12, 18].map((y) => <g key={y}><circle cx="5" cy={y} r="1.5" /><circle cx="11" cy={y} r="1.5" /></g>)}
        </svg>
      </button>
    </div>
    {children}
  </li>;
}
