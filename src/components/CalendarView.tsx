import { useState } from 'react'
import type { Note } from '../types'

interface Props {
  notes: Note[]
  onNoteSelect: (note: Note) => void
}

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

const DAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D']
const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

export default function CalendarView({ notes, onNoteSelect }: Props) {
  const today = new Date()
  const [current, setCurrent] = useState(new Date(today.getFullYear(), today.getMonth(), 1))
  const [selected, setSelected] = useState<Date>(today)
  const [panelOpen, setPanelOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem('cal-panel-open') !== 'false'
    } catch { return true }
  })

  const togglePanel = () => {
    setPanelOpen(prev => {
      const next = !prev
      try { localStorage.setItem('cal-panel-open', String(next)) } catch { /* ignore */ }
      return next
    })
  }

  const year = current.getFullYear()
  const month = current.getMonth()

  const firstDay = new Date(year, month, 1)
  const startOffset = (firstDay.getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const notesWithDate = notes.filter(n => !n.hidden && n.dueDate)

  function notesForDay(d: Date): Note[] {
    return notesWithDate.filter(n => sameDay(new Date(n.dueDate!), d))
  }

  function hasDot(d: Date): boolean {
    return notesWithDate.some(n => sameDay(new Date(n.dueDate!), d))
  }

  const selectedNotes = notesForDay(selected)

  const cells: (number | null)[] = [
    ...Array(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1)
  ]

  const selectedLabel = selected.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className={`calendar-wrap${panelOpen ? ' cal-with-panel' : ''}`}>
      {/* Left column: nav + grid */}
      <div className="cal-main">
        <div className="cal-nav">
          <button className="icon-btn" onClick={() => setCurrent(new Date(year, month - 1, 1))}>‹</button>
          <span className="cal-title">{MONTHS[month]} {year}</span>
          <button className="icon-btn" onClick={() => setCurrent(new Date(year, month + 1, 1))}>›</button>
          <button
            className={`icon-btn cal-panel-toggle${panelOpen ? ' active' : ''}`}
            onClick={togglePanel}
            aria-label={panelOpen ? 'Cerrar panel de eventos' : 'Abrir panel de eventos'}
            title={panelOpen ? 'Cerrar panel' : 'Ver eventos del día'}
          >
            {panelOpen ? '✕' : '📋'}
          </button>
        </div>

        <div className="cal-grid">
          {DAYS.map(d => (
            <div key={d} className="cal-day-header">{d}</div>
          ))}

          {cells.map((day, i) => {
            if (!day) return <div key={`e${i}`} />
            const date = new Date(year, month, day)
            const isToday = sameDay(date, today)
            const isSel = sameDay(date, selected)
            const dot = hasDot(date)
            return (
              <button
                key={day}
                className={`cal-day ${isToday ? 'today' : ''} ${isSel ? 'selected' : ''}`}
                onClick={() => setSelected(date)}
              >
                {day}
                {dot && <span className="cal-dot" />}
              </button>
            )
          })}
        </div>
      </div>

      {/* Right panel: events for selected day */}
      <div className={`cal-panel${panelOpen ? ' cal-panel--open' : ''}`} aria-hidden={!panelOpen}>
        <div className="cal-events">
          <p className="cal-events-title">{selectedLabel}</p>
          {selectedNotes.length === 0 ? (
            <p className="empty-msg" style={{ marginTop: 16 }}>Sin notas este día</p>
          ) : (
            selectedNotes.map(note => (
              <button key={note.id} className="event-row" onClick={() => onNoteSelect(note)}>
                <span className="event-stripe" style={{ background: note.color }} />
                <span className="event-body">
                  <span className="event-time">{formatTime(note.dueDate!)}</span>
                  <span className="event-text">{stripHtml(note.content) || 'Nota vacía'}</span>
                </span>
                <span className="note-row-chevron">›</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
