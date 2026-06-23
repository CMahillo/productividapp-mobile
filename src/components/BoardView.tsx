import { useState, useMemo, useRef } from 'react'
import {
  DndContext,
  DragEndEvent,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable
} from '@dnd-kit/core'
import type { Note } from '../types'
import NoteEditor from './NoteEditor'

type FilterMode = 'labels' | 'dates'

interface Column {
  id: string
  label: string
  notes: Note[]
  canDrop: boolean
  canAdd: boolean
  defaultLabel?: string
  defaultDueDate?: string
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0
  const date = d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
  return hasTime
    ? `${date} · ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`
    : date
}

function todayAt9(): string {
  const d = new Date()
  d.setHours(9, 0, 0, 0)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T09:00:00`
}

function inDays(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  d.setHours(9, 0, 0, 0)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T09:00:00`
}

function buildLabelColumns(notes: Note[]): Column[] {
  const labels = [...new Set(
    notes.filter(n => !n.hidden && n.label).map(n => n.label as string)
  )]
  const cols: Column[] = labels.map(l => ({
    id: `label:${l}`,
    label: l,
    notes: notes.filter(n => !n.hidden && n.label === l),
    canDrop: true,
    canAdd: true,
    defaultLabel: l
  }))
  const unlabeled = notes.filter(n => !n.hidden && !n.label)
  if (unlabeled.length > 0) {
    cols.push({
      id: 'label:__none',
      label: 'Sin etiqueta',
      notes: unlabeled,
      canDrop: true,
      canAdd: true
    })
  }
  return cols
}

function buildDateColumns(notes: Note[]): Column[] {
  const now = new Date()
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999)
  const weekEnd = new Date(todayEnd); weekEnd.setDate(weekEnd.getDate() + 6)
  const visible = notes.filter(n => !n.hidden)

  const cols: Column[] = [
    {
      id: '_overdue',
      label: '⚠️ Vencidas',
      notes: visible.filter(n => n.dueDate && new Date(n.dueDate) < todayStart),
      canDrop: false,
      canAdd: false
    },
    {
      id: '_today',
      label: '📅 Hoy',
      notes: visible.filter(n => n.dueDate && new Date(n.dueDate) >= todayStart && new Date(n.dueDate) <= todayEnd),
      canDrop: true,
      canAdd: true,
      defaultDueDate: todayAt9()
    },
    {
      id: '_week',
      label: '📆 Esta semana',
      notes: visible.filter(n => n.dueDate && new Date(n.dueDate) > todayEnd && new Date(n.dueDate) <= weekEnd),
      canDrop: true,
      canAdd: true,
      defaultDueDate: inDays(2)
    },
    {
      id: '_later',
      label: '🔮 Más adelante',
      notes: visible.filter(n => n.dueDate && new Date(n.dueDate) > weekEnd),
      canDrop: true,
      canAdd: true,
      defaultDueDate: inDays(14)
    },
    {
      id: '_nodate',
      label: '🗒 Sin fecha',
      notes: visible.filter(n => !n.dueDate),
      canDrop: true,
      canAdd: true
    }
  ]
  return cols.filter(c => c.notes.length > 0)
}

function BoardNoteCard({ note, onTap, onDelete }: { note: Note; onTap: () => void; onDelete: () => void }) {
  const [showMenu, setShowMenu] = useState(false)
  const longTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pointerPos = useRef<{ x: number; y: number } | null>(null)
  const didLongPress = useRef(false)

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: note.id,
    disabled: showMenu
  })

  const cancelLongPress = () => {
    if (longTimer.current) { clearTimeout(longTimer.current); longTimer.current = null }
  }

  const { onPointerDown: dndPointerDown, ...restListeners } = (listeners ?? {}) as {
    onPointerDown?: React.PointerEventHandler<HTMLDivElement>
    [key: string]: unknown
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    didLongPress.current = false
    pointerPos.current = { x: e.clientX, y: e.clientY }
    longTimer.current = setTimeout(() => {
      didLongPress.current = true
      setShowMenu(true)
    }, 500)
    dndPointerDown?.(e)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pointerPos.current && longTimer.current) {
      const dx = Math.abs(e.clientX - pointerPos.current.x)
      const dy = Math.abs(e.clientY - pointerPos.current.y)
      if (dx > 8 || dy > 8) cancelLongPress()
    }
  }

  const handleClick = () => {
    if (didLongPress.current) { didLongPress.current = false; return }
    onTap()
  }

  const text = stripHtml(note.content)

  const style: React.CSSProperties = {
    background: note.color,
    touchAction: 'none',
    ...(transform
      ? { transform: `translate3d(${transform.x}px,${transform.y}px,0)`, zIndex: 999, opacity: 0.9 }
      : {})
  }

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        className={`board-note${isDragging ? ' dragging' : ''}`}
        {...attributes}
        {...restListeners}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={cancelLongPress}
        onPointerCancel={cancelLongPress}
        onContextMenu={(e) => { e.preventDefault(); cancelLongPress(); didLongPress.current = true; setShowMenu(true) }}
        onClick={handleClick}
      >
        <div className="board-note-text">{text || 'Nota vacía'}</div>
        {note.dueDate && <div className="board-note-date">🗓 {formatDate(note.dueDate)}</div>}
        {note.label && <div className="board-note-chip">{note.label}</div>}
      </div>

      {showMenu && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-end' }}
          onClick={() => setShowMenu(false)}
        >
          <div
            style={{ background: '#fff', borderRadius: '16px 16px 0 0', padding: '16px', width: '100%', boxSizing: 'border-box' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ textAlign: 'center', marginBottom: 14, fontSize: 13, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '0 8px' }}>
              {text.slice(0, 60) || 'Nota vacía'}
            </div>
            <button
              onClick={() => { setShowMenu(false); onDelete() }}
              style={{ width: '100%', padding: '14px', borderRadius: 12, border: 'none', background: '#FEE2E2', color: '#DC2626', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}
            >
              🗑 Eliminar nota
            </button>
            <button
              onClick={() => setShowMenu(false)}
              style={{ width: '100%', padding: '14px', borderRadius: 12, border: 'none', background: '#f3f4f6', color: '#374151', fontSize: 15, cursor: 'pointer', marginTop: 10 }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </>
  )
}

function BoardColumn({
  col,
  onAdd,
  onNoteTap,
  onNoteDelete
}: {
  col: Column
  onAdd: () => void
  onNoteTap: (note: Note) => void
  onNoteDelete: (note: Note) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id, disabled: !col.canDrop })

  return (
    <div className="board-col">
      <div className="board-col-header">
        <span className="board-col-title">{col.label}</span>
        <span className="board-col-count">{col.notes.length}</span>
      </div>
      <div
        ref={setNodeRef}
        className={`board-col-body${isOver && col.canDrop ? ' drop-over' : ''}${!col.canDrop ? ' no-drop' : ''}`}
      >
        {col.notes.map(note => (
          <BoardNoteCard
            key={note.id}
            note={note}
            onTap={() => onNoteTap(note)}
            onDelete={() => onNoteDelete(note)}
          />
        ))}
        {col.canAdd && (
          <button className="board-add-btn" onClick={onAdd}>
            + Añadir nota
          </button>
        )}
      </div>
    </div>
  )
}

interface Props {
  notes: Note[]
  onSave: (notes: Note[]) => void
}

type EditState = { note: Note | null; defaultLabel?: string; defaultDueDate?: string } | null

export default function BoardView({ notes, onSave }: Props) {
  const [mode, setMode] = useState<FilterMode>('labels')
  const [editState, setEditState] = useState<EditState>(null)

  const allLabels = useMemo(
    () => [...new Set(notes.filter(n => !n.hidden && n.label).map(n => n.label as string))],
    [notes]
  )

  const columns = useMemo(
    () => (mode === 'labels' ? buildLabelColumns(notes) : buildDateColumns(notes)),
    [notes, mode]
  )

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 550, tolerance: 6 } })
  )

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return
    const noteId = active.id as string
    const colId = over.id as string
    const note = notes.find(n => n.id === noteId)
    if (!note) return
    const col = columns.find(c => c.id === colId)
    if (!col?.canDrop) return

    let updated: Note
    if (mode === 'labels') {
      const newLabel = col.id === 'label:__none' ? undefined : col.id.replace('label:', '')
      updated = { ...note, label: newLabel }
    } else {
      if (colId === '_overdue') return
      if (colId === '_nodate') {
        const copy = { ...note }
        delete copy.dueDate
        updated = copy
      } else if (colId === '_today') {
        updated = { ...note, dueDate: todayAt9() }
      } else if (colId === '_week') {
        updated = { ...note, dueDate: inDays(2) }
      } else {
        updated = { ...note, dueDate: inDays(14) }
      }
    }

    onSave(notes.map(n => (n.id === noteId ? updated : n)))
  }

  const handleNoteSave = (note: Note) => {
    const idx = notes.findIndex(n => n.id === note.id)
    onSave(idx >= 0 ? notes.map((n, i) => (i === idx ? note : n)) : [...notes, note])
    setEditState(null)
  }

  const handleNoteDelete = (note: Note) => {
    onSave(notes.filter(n => n.id !== note.id))
  }

  return (
    <div className="board-wrap">
      <div className="board-filter">
        <button
          className={`board-filter-btn${mode === 'labels' ? ' active' : ''}`}
          onClick={() => setMode('labels')}
        >
          Etiquetas
        </button>
        <button
          className={`board-filter-btn${mode === 'dates' ? ' active' : ''}`}
          onClick={() => setMode('dates')}
        >
          Fechas
        </button>
      </div>

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="board-scroll">
          {columns.map(col => (
            <BoardColumn
              key={col.id}
              col={col}
              onAdd={() =>
                setEditState({ note: null, defaultLabel: col.defaultLabel, defaultDueDate: col.defaultDueDate })
              }
              onNoteTap={note => setEditState({ note })}
              onNoteDelete={handleNoteDelete}
            />
          ))}
        </div>
      </DndContext>

      {editState !== null && (
        <NoteEditor
          note={editState.note}
          labels={allLabels}
          defaultLabel={editState.defaultLabel}
          defaultDueDate={editState.defaultDueDate}
          onSave={handleNoteSave}
          onClose={() => setEditState(null)}
        />
      )}
    </div>
  )
}
