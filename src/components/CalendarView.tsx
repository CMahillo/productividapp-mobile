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

  const year = current.getFullYear()
  const month = current.getMonth()

  // Days in month grid
  const firstDay = new Date(year, month, 1)
  // Monday-first: convert Sunday(0) → 6, Monday(1) → 0, etc.
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

  return (
    <div className="calendar-wrap">
      {/* Month nav */}
      <div className="cal-nav">
        <button className="icon-btn" onClick={() => setCurrent(new Date(year, month - 1, 1))}>‹</button>
        <span className="cal-title">{MONTHS[month]} {year}</span>
        <button className="icon-btn" onClick={() => setCurrent(new Date(year, month + 1, 1))}>›</button>
      </div>

      {/* Day headers */}
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

      {/* Notes for selected day */}
      <div className="cal-events">
        <p className="cal-events-title">
          {selected.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
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
  )
}
