import { useState, useMemo } from 'react'
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
  cols.push({
    id: 'label:__none',
    label: 'Sin etiqueta',
    notes: notes.filter(n => !n.hidden && !n.label),
    canDrop: true,
    canAdd: true
  })
  return cols
}

function buildDateColumns(notes: Note[]): Column[] {
  const now = new Date()
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999)
  const weekEnd = new Date(todayEnd); weekEnd.setDate(weekEnd.getDate() + 6)
  const visible = notes.filter(n => !n.hidden)

  return [
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
}

function BoardNoteCard({ note, onTap }: { note: Note; onTap: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: note.id })

  const style: React.CSSProperties = {
    background: note.color,
    touchAction: 'none',
    ...(transform
      ? { transform: `translate3d(${transform.x}px,${transform.y}px,0)`, zIndex: 999, opacity: 0.9 }
      : {})
  }

  const text = stripHtml(note.content)

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`board-note${isDragging ? ' dragging' : ''}`}
      {...listeners}
      {...attributes}
      onClick={onTap}
    >
      <div className="board-note-text">{text || 'Nota vacía'}</div>
      {note.dueDate && <div className="board-note-date">🗓 {formatDate(note.dueDate)}</div>}
      {note.label && <div className="board-note-chip">{note.label}</div>}
    </div>
  )
}

function BoardColumn({
  col,
  onAdd,
  onNoteTap
}: {
  col: Column
  onAdd: () => void
  onNoteTap: (note: Note) => void
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
          <BoardNoteCard key={note.id} note={note} onTap={() => onNoteTap(note)} />
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
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } })
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
        updated = { ...note, dueDate: undefined }
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
