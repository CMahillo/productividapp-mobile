import { useState, useCallback, useEffect, useRef } from 'react'
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
} from '@dnd-kit/core'
import type { Note } from '../types'

interface Props {
  notes: Note[]
  onNoteSelect: (note: Note) => void
  onSave: (notes: Note[]) => void
  onNewNote?: (date: Date) => void
}

type CalView = 'month' | 'week'

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0
  return hasTime ? d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : 'Todo el día'
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function getMondayOf(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay()
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
  return d
}

function weekDays(monday: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return d
  })
}

function padN(n: number) { return String(n).padStart(2, '0') }

function toDateKey(d: Date) {
  return `${d.getFullYear()}-${padN(d.getMonth() + 1)}-${padN(d.getDate())}`
}

const DAY_NAMES = ['L', 'M', 'X', 'J', 'V', 'S', 'D']
const DAY_NAMES_FULL = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const MONTHS_SHORT = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']

// ── Sub-components ─────────────────────────────────────────────────────────

function DroppableDay({ dateKey, children, className, onClick }: {
  dateKey: string
  children: React.ReactNode
  className?: string
  onClick?: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${dateKey}` })
  return (
    <div
      ref={setNodeRef}
      className={`${className ?? ''}${isOver ? ' cal-drop-over' : ''}`}
      onClick={onClick}
    >
      {children}
    </div>
  )
}

function DraggableCalNote({ note, onTap }: { note: Note; onTap: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: note.id,
    data: { note }
  })
  return (
    <button
      ref={setNodeRef}
      className={`event-row${isDragging ? ' cal-dragging' : ''}`}
      style={{ touchAction: 'none' }}
      {...attributes}
      {...listeners}
      onClick={onTap}
    >
      <span className="event-stripe" style={{ background: note.color }} />
      <span className="event-body">
        <span className="event-time">{formatTime(note.dueDate!)}</span>
        <span className="event-text">{stripHtml(note.content) || 'Nota vacía'}</span>
      </span>
      <span className="note-row-chevron">›</span>
    </button>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export default function CalendarView({ notes, onNoteSelect, onSave, onNewNote }: Props) {
  const today = new Date()

  const [calView, setCalView] = useState<CalView>(() => {
    try { return (localStorage.getItem('cal-view') as CalView) || 'month' } catch { return 'month' }
  })
  const [current, setCurrent] = useState(new Date(today.getFullYear(), today.getMonth(), 1))
  const [weekAnchor, setWeekAnchor] = useState(() => getMondayOf(today))
  const [selected, setSelected] = useState<Date>(today)
  const [panelOpen, setPanelOpen] = useState<boolean>(() => {
    try { return localStorage.getItem('cal-panel-open') !== 'false' } catch { return true }
  })
  const [showWeekends, setShowWeekends] = useState<boolean>(() => {
    try { return localStorage.getItem('cal-show-weekends') === 'true' } catch { return false }
  })
  const [activeNote, setActiveNote] = useState<Note | null>(null)
  const weekScrollRef = useRef<HTMLDivElement>(null)
  const todayColRef = useRef<HTMLDivElement>(null)
  const longTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const didLongPress = useRef(false)
  const longPressPos = useRef<{ x: number; y: number } | null>(null)

  function startLongPress(date: Date, e: React.PointerEvent) {
    didLongPress.current = false
    longPressPos.current = { x: e.clientX, y: e.clientY }
    longTimer.current = setTimeout(() => {
      didLongPress.current = true
      longPressPos.current = null
      onNewNote?.(date)
    }, 500)
  }
  function checkLongPressMove(e: React.PointerEvent) {
    if (!longPressPos.current || !longTimer.current) return
    const dx = Math.abs(e.clientX - longPressPos.current.x)
    const dy = Math.abs(e.clientY - longPressPos.current.y)
    if (dx > 10 || dy > 10) cancelLongPress()
  }
  function cancelLongPress() {
    if (longTimer.current) { clearTimeout(longTimer.current); longTimer.current = null }
    longPressPos.current = null
  }

  // Scroll today's column into view when the week view is active
  useEffect(() => {
    if (calView !== 'week') return
    const container = weekScrollRef.current
    const col = todayColRef.current
    if (container && col) {
      container.scrollLeft = Math.max(0, col.offsetLeft - container.offsetLeft - 12)
    }
  }, [calView, weekAnchor])

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } })
  )

  const switchView = (v: CalView) => {
    if (v === 'week') setWeekAnchor(getMondayOf(selected))
    else setCurrent(new Date(selected.getFullYear(), selected.getMonth(), 1))
    setCalView(v)
    try { localStorage.setItem('cal-view', v) } catch { /* ignore */ }
  }

  const togglePanel = () => {
    setPanelOpen(prev => {
      const next = !prev
      try { localStorage.setItem('cal-panel-open', String(next)) } catch { /* ignore */ }
      return next
    })
  }

  const toggleWeekends = () => {
    setShowWeekends(prev => {
      const next = !prev
      try { localStorage.setItem('cal-show-weekends', String(next)) } catch { /* ignore */ }
      return next
    })
  }

  const notesWithDate = notes.filter(n => !n.hidden && n.dueDate)

  function notesForDay(d: Date): Note[] {
    return notesWithDate.filter(n => sameDay(new Date(n.dueDate!), d))
  }

  function hasDot(d: Date): boolean {
    return notesWithDate.some(n => sameDay(new Date(n.dueDate!), d))
  }

  const handleDragStart = useCallback((e: DragStartEvent) => {
    const data = e.active.data.current as { note: Note } | undefined
    setActiveNote(data?.note ?? null)
  }, [])

  const handleDragEnd = useCallback(({ active, over }: DragEndEvent) => {
    setActiveNote(null)
    if (!over) return
    const data = active.data.current as { note: Note } | undefined
    const note = data?.note
    if (!note) return
    const overIdStr = over.id as string
    if (!overIdStr.startsWith('day:')) return
    const dateKey = overIdStr.slice(4)
    if (note.dueDate?.startsWith(dateKey)) return // same day, nothing to do
    const [yr, mo, da] = dateKey.split('-').map(Number)
    const existing = new Date(note.dueDate!)
    const newDate = new Date(yr, mo - 1, da, existing.getHours(), existing.getMinutes(), 0, 0)
    const newDueDate = `${newDate.getFullYear()}-${padN(newDate.getMonth()+1)}-${padN(newDate.getDate())}T${padN(newDate.getHours())}:${padN(newDate.getMinutes())}:00`
    if (calView === 'month') setSelected(new Date(yr, mo - 1, da))
    onSave(notes.map(n => n.id === note.id ? { ...n, dueDate: newDueDate } : n))
  }, [calView, notes, onSave])

  // ── Month view ─────────────────────────────────────────────────────────
  const year = current.getFullYear()
  const month = current.getMonth()
  const startOffset = (new Date(year, month, 1).getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (number | null)[] = [
    ...Array(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1)
  ]

  // ── Week view ───────────────────────────────────────────────────────────
  const days = weekDays(weekAnchor)
  const visibleDays = showWeekends ? days : days.slice(0, 5)
  const weekEnd = days[6]
  const weekLabel = (() => {
    const s = weekAnchor
    const e = weekEnd
    if (s.getMonth() === e.getMonth())
      return `${s.getDate()} – ${e.getDate()} ${MONTHS_SHORT[s.getMonth()]} ${s.getFullYear()}`
    if (s.getFullYear() === e.getFullYear())
      return `${s.getDate()} ${MONTHS_SHORT[s.getMonth()]} – ${e.getDate()} ${MONTHS_SHORT[e.getMonth()]} ${s.getFullYear()}`
    return `${s.getDate()} ${MONTHS_SHORT[s.getMonth()]} ${s.getFullYear()} – ${e.getDate()} ${MONTHS_SHORT[e.getMonth()]} ${e.getFullYear()}`
  })()

  const selectedNotes = notesForDay(selected)
  const selectedLabel = selected.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
  const showPanel = calView === 'month' && panelOpen

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setActiveNote(null)}>
      <div className={`calendar-wrap${showPanel ? ' cal-with-panel' : ''}`}>

        {/* Left column: nav + grid/week */}
        <div className="cal-main">

          {/* Navigation */}
          <div className="cal-nav">
            <button className="icon-btn" onClick={() => {
              if (calView === 'month') setCurrent(new Date(year, month - 1, 1))
              else setWeekAnchor(d => { const n = new Date(d); n.setDate(n.getDate() - 7); return n })
            }}>‹</button>

            <span className="cal-title">
              {calView === 'month' ? `${MONTHS[month]} ${year}` : weekLabel}
            </span>

            <button className="icon-btn" onClick={() => {
              if (calView === 'month') setCurrent(new Date(year, month + 1, 1))
              else setWeekAnchor(d => { const n = new Date(d); n.setDate(n.getDate() + 7); return n })
            }}>›</button>

            {calView === 'month' && (
              <button
                className={`icon-btn cal-panel-toggle${panelOpen ? ' active' : ''}`}
                onClick={togglePanel}
                aria-label={panelOpen ? 'Cerrar panel de eventos' : 'Abrir panel de eventos'}
              >
                {panelOpen ? '✕' : '📋'}
              </button>
            )}
            {calView === 'week' && (
              <button
                className={`icon-btn cal-weekend-toggle${showWeekends ? ' active' : ''}`}
                onClick={toggleWeekends}
                aria-label={showWeekends ? 'Ocultar fin de semana' : 'Mostrar fin de semana'}
              >
                S/D
              </button>
            )}
          </div>

          {/* View toggle */}
          <div className="cal-view-toggle">
            <button className={`cal-view-btn${calView === 'month' ? ' active' : ''}`} onClick={() => switchView('month')}>Mes</button>
            <button className={`cal-view-btn${calView === 'week' ? ' active' : ''}`} onClick={() => switchView('week')}>Semana</button>
          </div>

          {/* Month grid */}
          {calView === 'month' && (
            <div className="cal-grid">
              {DAY_NAMES.map(d => (
                <div key={d} className="cal-day-header">{d}</div>
              ))}
              {cells.map((day, i) => {
                if (!day) return <div key={`e${i}`} />
                const date = new Date(year, month, day)
                const dateKey = toDateKey(date)
                const isToday = sameDay(date, today)
                const isSel = sameDay(date, selected)
                const dot = hasDot(date)
                return (
                  <DroppableDay key={day} dateKey={dateKey} className="cal-day-droppable">
                    <button
                      className={`cal-day${isToday ? ' today' : ''}${isSel ? ' selected' : ''}${dot ? ' has-notes' : ''}`}
                      onPointerDown={(e) => startLongPress(date, e)}
                      onPointerUp={cancelLongPress}
                      onPointerCancel={cancelLongPress}
                      onPointerMove={checkLongPressMove}
                      onClick={() => { if (!didLongPress.current) setSelected(date) }}
                    >
                      {day}
                      {dot && <span className="cal-dot" />}
                    </button>
                  </DroppableDay>
                )
              })}
            </div>
          )}

          {/* Week columns */}
          {calView === 'week' && (
            <div className={`cal-week${showWeekends ? '' : ' cal-week--5col'}`} ref={weekScrollRef}>
              {visibleDays.map((date) => {
                const isToday = sameDay(date, today)
                const isSel = sameDay(date, selected)
                const dayNotes = notesForDay(date)
                const dateKey = toDateKey(date)
                const dayIdx = (date.getDay() + 6) % 7
                return (
                  <DroppableDay
                    key={dateKey}
                    dateKey={dateKey}
                    className={`cal-week-col${isToday ? ' today' : ''}${isSel ? ' selected' : ''}`}
                    onClick={() => setSelected(date)}
                  >
                    <div
                      ref={isToday ? todayColRef : null}
                      className="cal-week-col-header"
                      onPointerDown={(e) => startLongPress(date, e)}
                      onPointerUp={cancelLongPress}
                      onPointerCancel={cancelLongPress}
                      onPointerMove={checkLongPressMove}
                    >
                      <span className="cal-week-col-name">{DAY_NAMES_FULL[dayIdx]}</span>
                      <span className="cal-week-col-num">{date.getDate()}</span>
                      {isToday && <span className="cal-week-today-dot" />}
                    </div>
                    <div className="cal-week-col-body" onClick={e => e.stopPropagation()}>
                      {dayNotes.length === 0 ? (
                        <span className="cal-week-empty">—</span>
                      ) : (
                        dayNotes.map(note => (
                          <DraggableCalNote key={note.id} note={note} onTap={() => onNoteSelect(note)} />
                        ))
                      )}
                    </div>
                  </DroppableDay>
                )
              })}
            </div>
          )}
        </div>

        {/* Side panel (month mode only) */}
        <div className={`cal-panel${showPanel ? ' cal-panel--open' : ''}`} aria-hidden={!showPanel}>
          <div className="cal-events">
            <p className="cal-events-title">{selectedLabel}</p>
            {selectedNotes.length === 0 ? (
              <p className="empty-msg" style={{ marginTop: 16 }}>Sin notas este día</p>
            ) : (
              selectedNotes.map(note => (
                <DraggableCalNote key={note.id} note={note} onTap={() => onNoteSelect(note)} />
              ))
            )}
          </div>
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {activeNote && (
          <div className="cal-drag-overlay" style={{ background: activeNote.color }}>
            {stripHtml(activeNote.content).slice(0, 45) || 'Nota vacía'}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}
