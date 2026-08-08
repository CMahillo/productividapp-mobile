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
  alwaysShow?: boolean
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
  const tomorrowEnd = new Date(todayEnd); tomorrowEnd.setDate(tomorrowEnd.getDate() + 1)
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
      alwaysShow: true,
      defaultDueDate: todayAt9()
    },
    {
      id: '_tomorrow',
      label: '🌅 Mañana',
      notes: visible.filter(n => n.dueDate && new Date(n.dueDate) > todayEnd && new Date(n.dueDate) <= tomorrowEnd),
      canDrop: true,
      canAdd: true,
      alwaysShow: true,
      defaultDueDate: inDays(1)
    },
    {
      id: '_week',
      label: '📆 Esta semana',
      notes: visible.filter(n => n.dueDate && new Date(n.dueDate) > tomorrowEnd && new Date(n.dueDate) <= weekEnd),
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
  return cols.filter(c => c.notes.length > 0 || c.alwaysShow)
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
    // 'manipulation' deja que el navegador desplace en AMBOS ejes mientras no
    // se cumpla el delay del TouchSensor. Con 'pan-y' el arrastre horizontal
    // sobre una nota no movía el tablero.
    touchAction: 'manipulation',
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
  onNoteDelete,
  reorderMode,
  onMoveLeft,
  onMoveRight,
  isFirst,
  isLast
}: {
  col: Column
  onAdd: () => void
  onNoteTap: (note: Note) => void
  onNoteDelete: (note: Note) => void
  reorderMode: boolean
  onMoveLeft: () => void
  onMoveRight: () => void
  isFirst: boolean
  isLast: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id, disabled: !col.canDrop })

  return (
    <div className="board-col">
      <div className="board-col-header">
        {reorderMode && (
          <button
            className="board-reorder-btn"
            onClick={onMoveLeft}
            disabled={isFirst}
            aria-label="Mover columna a la izquierda"
          >◀</button>
        )}
        <span className="board-col-title">{col.label}</span>
        <span className="board-col-count">{col.notes.length}</span>
        {reorderMode && (
          <button
            className="board-reorder-btn"
            onClick={onMoveRight}
            disabled={isLast}
            aria-label="Mover columna a la derecha"
          >▶</button>
        )}
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
  const [reorderMode, setReorderMode] = useState(false)
  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('board-column-order')
      return saved ? (JSON.parse(saved) as string[]) : []
    } catch { return [] }
  })

  const allLabels = useMemo(
    () => [...new Set(notes.filter(n => !n.hidden && n.label).map(n => n.label as string))],
    [notes]
  )

  const rawColumns = useMemo(
    () => (mode === 'labels' ? buildLabelColumns(notes) : buildDateColumns(notes)),
    [notes, mode]
  )

  const columns = useMemo(() => {
    if (mode !== 'labels' || columnOrder.length === 0) return rawColumns
    const byId = new Map(rawColumns.map(c => [c.id, c]))
    const ordered: Column[] = []
    for (const id of columnOrder) {
      const col = byId.get(id)
      if (col) { ordered.push(col); byId.delete(id) }
    }
    for (const col of byId.values()) ordered.push(col)
    return ordered
  }, [rawColumns, columnOrder, mode])

  const moveColumn = (colId: string, direction: -1 | 1) => {
    const ids = columns.map(c => c.id)
    const idx = ids.indexOf(colId)
    if (idx < 0) return
    const newIdx = idx + direction
    if (newIdx < 0 || newIdx >= ids.length) return
    const newOrder = [...ids]
    ;[newOrder[idx], newOrder[newIdx]] = [newOrder[newIdx], newOrder[idx]]
    setColumnOrder(newOrder)
    localStorage.setItem('board-column-order', JSON.stringify(newOrder))
  }

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
      } else if (colId === '_tomorrow') {
        updated = { ...note, dueDate: inDays(1) }
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
          onClick={() => { setMode('labels'); setReorderMode(false) }}
        >
          Etiquetas
        </button>
        <button
          className={`board-filter-btn${mode === 'dates' ? ' active' : ''}`}
          onClick={() => { setMode('dates'); setReorderMode(false) }}
        >
          Fechas
        </button>
        {mode === 'labels' && (
          <button
            className={`board-filter-btn board-filter-btn--reorder${reorderMode ? ' active' : ''}`}
            onClick={() => setReorderMode(r => !r)}
          >
            {reorderMode ? 'Listo' : '⇄'}
          </button>
        )}
      </div>

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="board-scroll">
          {columns.map((col, idx) => (
            <BoardColumn
              key={col.id}
              col={col}
              onAdd={() =>
                setEditState({ note: null, defaultLabel: col.defaultLabel, defaultDueDate: col.defaultDueDate })
              }
              onNoteTap={note => setEditState({ note })}
              onNoteDelete={handleNoteDelete}
              reorderMode={reorderMode}
              onMoveLeft={() => moveColumn(col.id, -1)}
              onMoveRight={() => moveColumn(col.id, 1)}
              isFirst={idx === 0}
              isLast={idx === columns.length - 1}
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
