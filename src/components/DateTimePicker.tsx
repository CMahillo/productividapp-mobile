import { useState } from 'react'

interface Props {
  value: string | undefined   // ISO string or undefined
  onChange: (iso: string | undefined) => void
  onClose: () => void
}

const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const DAYS_HDR = ['L','M','X','J','V','S','D']
const MINUTES = [0, 15, 30, 45]

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export default function DateTimePicker({ value, onChange, onClose }: Props) {
  const initial = value ? new Date(value) : null
  const today = new Date()

  const [view, setView] = useState<Date>(initial ?? new Date(today.getFullYear(), today.getMonth(), 1))
  const [selectedDate, setSelectedDate] = useState<Date | null>(initial)
  const [hour, setHour] = useState<number>(initial?.getHours() ?? -1)   // -1 = sin hora
  const [minute, setMinute] = useState<number>(initial ? (Math.round(initial.getMinutes() / 15) * 15) % 60 : 0)

  const year = view.getFullYear()
  const month = view.getMonth()
  const firstDay = new Date(year, month, 1)
  const startOffset = (firstDay.getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (number | null)[] = [...Array(startOffset).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]

  const hours = Array.from({ length: 24 }, (_, i) => i)

  const handleSave = () => {
    if (!selectedDate) return
    const d = new Date(selectedDate)
    if (hour >= 0) {
      d.setHours(hour, minute, 0, 0)
    } else {
      d.setHours(0, 0, 0, 0)
    }
    onChange(d.toISOString())
    onClose()
  }

  const handleClear = () => {
    onChange(undefined)
    onClose()
  }

  return (
    <div className="dtp-overlay" onClick={onClose}>
      <div className="dtp-sheet" onClick={e => e.stopPropagation()}>
        <div className="editor-handle" />

        {/* Month navigation */}
        <div className="dtp-nav">
          <button className="icon-btn" onClick={() => setView(new Date(year, month - 1, 1))}>‹</button>
          <span className="dtp-month">{MONTHS[month]} {year}</span>
          <button className="icon-btn" onClick={() => setView(new Date(year, month + 1, 1))}>›</button>
        </div>

        {/* Calendar grid */}
        <div className="dtp-grid">
          {DAYS_HDR.map(d => <div key={d} className="dtp-day-hdr">{d}</div>)}
          {cells.map((day, i) => {
            if (!day) return <div key={`e${i}`} />
            const date = new Date(year, month, day)
            const isToday = sameDay(date, today)
            const isSel = selectedDate ? sameDay(date, selectedDate) : false
            const isPast = date < new Date(today.getFullYear(), today.getMonth(), today.getDate())
            return (
              <button
                key={day}
                className={`dtp-day ${isToday ? 'today' : ''} ${isSel ? 'selected' : ''} ${isPast ? 'past' : ''}`}
                onClick={() => setSelectedDate(date)}
              >{day}</button>
            )
          })}
        </div>

        {/* Time selector (only if date selected) */}
        {selectedDate && (
          <div className="dtp-time">
            <div className="dtp-time-header">
              <span className="dtp-time-label">Hora (opcional)</span>
              {hour >= 0 && (
                <button className="dtp-time-clear" onClick={() => setHour(-1)}>Sin hora</button>
              )}
            </div>
            {hour < 0 ? (
              <button className="dtp-time-add" onClick={() => setHour(9)}>+ Añadir hora</button>
            ) : (
              <div className="dtp-time-selectors">
                <div className="dtp-scroll-wrap">
                  <div className="dtp-scroll">
                    {hours.map(h => (
                      <button
                        key={h}
                        className={`dtp-scroll-item ${h === hour ? 'selected' : ''}`}
                        onClick={() => setHour(h)}
                      >{String(h).padStart(2, '0')}</button>
                    ))}
                  </div>
                </div>
                <span className="dtp-colon">:</span>
                <div className="dtp-min-wrap">
                  {MINUTES.map(m => (
                    <button
                      key={m}
                      className={`dtp-min-btn ${m === minute ? 'selected' : ''}`}
                      onClick={() => setMinute(m)}
                    >{String(m).padStart(2, '0')}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="dtp-actions">
          {value && <button className="btn-secondary" style={{ flex: 'none', padding: '12px 16px', fontSize: 14 }} onClick={handleClear}>Quitar fecha</button>}
          <div style={{ flex: 1 }} />
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" onClick={handleSave} disabled={!selectedDate}>Guardar</button>
        </div>
      </div>
    </div>
  )
}
