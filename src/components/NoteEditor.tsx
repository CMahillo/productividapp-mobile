import { useState } from 'react'
import type { Note } from '../types'

const COLORS = [
  '#fef9c3', '#bbf7d0', '#bfdbfe', '#fecaca',
  '#e9d5ff', '#fed7aa', '#f0fdf4', '#f1f5f9'
]

function stripHtml(html: string): string {
  const d = document.createElement('div')
  d.innerHTML = html
  return d.textContent ?? ''
}

function textToHtml(text: string): string {
  return text.trim()
    .split('\n')
    .map(line => `<p>${line || '<br>'}</p>`)
    .join('')
}

interface Props {
  note: Note | null
  onSave: (note: Note) => void
  onClose: () => void
}

export default function NoteEditor({ note, onSave, onClose }: Props) {
  const [text, setText] = useState(note ? stripHtml(note.content) : '')
  const [color, setColor] = useState(note?.color ?? '#fef9c3')
  const [dueDate, setDueDate] = useState(
    note?.dueDate ? new Date(note.dueDate).toISOString().slice(0, 16) : ''
  )

  const handleSave = () => {
    if (!text.trim() && !note) { onClose(); return }
    const now = new Date().toISOString()
    const saved: Note = note
      ? { ...note, content: textToHtml(text), color, dueDate: dueDate ? new Date(dueDate).toISOString() : undefined }
      : {
          id: crypto.randomUUID(),
          content: textToHtml(text),
          x: 100, y: 100, width: 220, height: 190,
          color,
          dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
          createdAt: now,
          fontSize: 13
        }
    onSave(saved)
  }

  return (
    <div className="editor-overlay" onClick={onClose}>
      <div className="editor-sheet" onClick={e => e.stopPropagation()}>
        <div className="editor-handle" />
        <div className="editor-header">
          <span className="editor-title">{note ? 'Editar nota' : 'Nueva nota'}</span>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>

        <textarea
          className="editor-textarea"
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Escribe tu nota..."
          autoFocus
          rows={7}
        />

        <div className="color-row">
          {COLORS.map(c => (
            <button
              key={c}
              className={`color-dot ${c === color ? 'selected' : ''}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>

        <div className="date-row">
          <label className="date-label">📅 Recordatorio</label>
          <input
            className="date-input"
            type="datetime-local"
            value={dueDate}
            onChange={e => setDueDate(e.target.value)}
          />
        </div>

        <div className="editor-actions">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" onClick={handleSave}>Guardar</button>
        </div>
      </div>
    </div>
  )
}
