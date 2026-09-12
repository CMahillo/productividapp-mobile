import { useRef, useState } from 'react'

interface Props {
  value: string | undefined   // local string 'YYYY-MM-DDTHH:MM:SS' or undefined
  onChange: (local: string | undefined) => void
  onClose: () => void
}

const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const DAYS_HDR = ['L','M','X','J','V','S','D']

// Radios del dial (en % del ancho/alto del contenedor, medidos desde el centro).
const R_OUTER = 40
const R_INNER = 25
const R_MINUTE = 40
// Umbral (ratio respecto al radio máximo = 50%) para distinguir anillo exterior/interior en modo hora.
const RING_THRESHOLD = (R_OUTER + R_INNER) / 2 / 50

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

// Las fechas de la app se guardan como string local sin zona horaria ('YYYY-MM-DDTHH:MM:SS'),
// nunca con 'Z'/offset (ver CONTEXTO.md §3.8) — evita el desfase que introduciría toISOString().
function toLocalIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

// Posición en % (left/top) de un punto a `radiusPct` del centro, en el slot angular `idx` de 12 (30° cada uno).
function posForIndex(idx: number, radiusPct: number): { left: string; top: string } {
  const angleRad = ((idx * 30) * Math.PI) / 180
  const x = 50 + radiusPct * Math.sin(angleRad)
  const y = 50 - radiusPct * Math.cos(angleRad)
  return { left: `${x}%`, top: `${y}%` }
}

export default function DateTimePicker({ value, onChange, onClose }: Props) {
  const initial = value ? new Date(value) : null
  const today = new Date()

  const [view, setView] = useState<Date>(initial ?? new Date(today.getFullYear(), today.getMonth(), 1))
  const [selectedDate, setSelectedDate] = useState<Date | null>(initial)
  const [hour, setHour] = useState<number>(initial?.getHours() ?? -1)   // -1 = sin hora
  const [minute, setMinute] = useState<number>(initial ? Math.round(initial.getMinutes() / 5) * 5 % 60 : 0)
  const [dialMode, setDialMode] = useState<'hour' | 'minute'>('hour')
  const [dragging, setDragging] = useState(false)

  const faceRef = useRef<HTMLDivElement>(null)

  const year = view.getFullYear()
  const month = view.getMonth()
  const firstDay = new Date(year, month, 1)
  const startOffset = (firstDay.getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (number | null)[] = [...Array(startOffset).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]

  const handleSave = () => {
    if (!selectedDate) return
    const d = new Date(selectedDate)
    if (hour >= 0) {
      d.setHours(hour, minute, 0, 0)
    } else {
      d.setHours(0, 0, 0, 0)
    }
    onChange(toLocalIso(d))
    onClose()
  }

  const handleClear = () => {
    onChange(undefined)
    onClose()
  }

  const pickQuick = (d: Date) => {
    onChange(toLocalIso(d))
    onClose()
  }

  // ── Lógica del dial (tap + arrastre, pointer events) ──
  const angleFromEvent = (e: React.PointerEvent): number => {
    const rect = faceRef.current?.getBoundingClientRect()
    if (!rect) return 0
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const dx = e.clientX - cx
    const dy = e.clientY - cy
    let angle = (Math.atan2(dx, -dy) * 180) / Math.PI
    if (angle < 0) angle += 360
    return angle
  }

  const ringRatioFromEvent = (e: React.PointerEvent): number => {
    const rect = faceRef.current?.getBoundingClientRect()
    if (!rect) return 1
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const dx = e.clientX - cx
    const dy = e.clientY - cy
    const dist = Math.sqrt(dx * dx + dy * dy)
    return dist / (rect.width / 2)
  }

  const updateFromPointer = (e: React.PointerEvent) => {
    const angle = angleFromEvent(e)
    const idx = Math.round(angle / 30) % 12
    if (dialMode === 'hour') {
      const isInner = ringRatioFromEvent(e) < RING_THRESHOLD
      setHour(isInner ? idx + 12 : idx)
    } else {
      setMinute((idx * 5) % 60)
    }
  }

  const handlePointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
    updateFromPointer(e)
  }
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging) return
    updateFromPointer(e)
  }
  const handlePointerUp = (e: React.PointerEvent) => {
    if (!dragging) return
    setDragging(false)
    updateFromPointer(e)
    if (dialMode === 'hour') setDialMode('minute')
  }

  const handAngle = dialMode === 'hour' ? (hour % 12) * 30 : minute * 6
  const handRadius = dialMode === 'hour' ? (hour >= 12 ? R_INNER : R_OUTER) : R_MINUTE

  return (
    <div className="dtp-overlay" onClick={onClose}>
      <div className="dtp-sheet" onClick={e => e.stopPropagation()}>
        <div className="editor-handle" />

        {/* Fechas rápidas */}
        <div className="dtp-quick">
          {[
            { label: '⏰ Más tarde hoy', getDt: () => { const d = new Date(); d.setHours(d.getHours() + 4); return d } },
            { label: '🌅 Mañana 9:00', getDt: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d } },
            { label: '📆 Lunes próximo 9:00', getDt: () => { const d = new Date(); const day = d.getDay(); d.setDate(d.getDate() + (day === 0 ? 1 : day === 1 ? 7 : 8 - day)); d.setHours(9, 0, 0, 0); return d } },
          ].map(({ label, getDt }) => (
            <button key={label} className="dtp-quick-btn" onClick={() => pickQuick(getDt())}>{label}</button>
          ))}
        </div>

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
              <button className="dtp-time-add" onClick={() => { setHour(9); setMinute(0); setDialMode('hour') }}>+ Añadir hora</button>
            ) : (
              <>
                <div className="dtp-dial-display">
                  <button
                    type="button"
                    className={`dtp-dial-hm ${dialMode === 'hour' ? 'active' : ''}`}
                    onClick={() => setDialMode('hour')}
                  >{String(hour).padStart(2, '0')}</button>
                  <span className="dtp-dial-colon">:</span>
                  <button
                    type="button"
                    className={`dtp-dial-hm ${dialMode === 'minute' ? 'active' : ''}`}
                    onClick={() => setDialMode('minute')}
                  >{String(minute).padStart(2, '0')}</button>
                </div>

                <div
                  ref={faceRef}
                  className="dtp-dial-face"
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                >
                  <div
                    className="dtp-dial-hand"
                    style={{ height: `${handRadius}%`, transform: `translate(-50%, -100%) rotate(${handAngle}deg)` }}
                  />
                  <div className="dtp-dial-center" />

                  {dialMode === 'hour' ? (
                    <>
                      {Array.from({ length: 12 }, (_, i) => i).map(h => (
                        <div key={`o${h}`} className={`dtp-dial-num ${hour === h ? 'selected' : ''}`} style={posForIndex(h, R_OUTER)}>
                          {h}
                        </div>
                      ))}
                      {Array.from({ length: 12 }, (_, i) => i + 12).map(h => (
                        <div key={`i${h}`} className={`dtp-dial-num inner ${hour === h ? 'selected' : ''}`} style={posForIndex(h - 12, R_INNER)}>
                          {h}
                        </div>
                      ))}
                    </>
                  ) : (
                    Array.from({ length: 12 }, (_, i) => i * 5).map(m => (
                      <div key={`m${m}`} className={`dtp-dial-num ${minute === m ? 'selected' : ''}`} style={posForIndex(m / 5, R_MINUTE)}>
                        {String(m).padStart(2, '0')}
                      </div>
                    ))
                  )}
                </div>
              </>
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
