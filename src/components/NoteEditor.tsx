import { useState, useRef, useEffect } from 'react'
import type { Note } from '../types'
import DateTimePicker from './DateTimePicker'

const COLORS = [
  '#fef9c3', '#bbf7d0', '#bfdbfe', '#fecaca',
  '#e9d5ff', '#fed7aa', '#f0fdf4', '#f1f5f9'
]

interface Props {
  note: Note | null
  onSave: (note: Note) => void
  onClose: () => void
}

export default function NoteEditor({ note, onSave, onClose }: Props) {
  const [color, setColor] = useState(note?.color ?? '#fef9c3')
  const [dueDate, setDueDate] = useState<string | undefined>(note?.dueDate)
  const [showDatePicker, setShowDatePicker] = useState(false)
  const editorRef = useRef<HTMLDivElement>(null)

  // Initialise contenteditable with existing HTML
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.innerHTML = note?.content ?? ''
      // Place cursor at end
      const range = document.createRange()
      const sel = window.getSelection()
      range.selectNodeContents(editorRef.current)
      range.collapse(false)
      sel?.removeAllRanges()
      sel?.addRange(range)
      editorRef.current.focus()
    }
  }, [])

  const exec = (cmd: string, value?: string) => {
    editorRef.current?.focus()
    document.execCommand(cmd, false, value)
  }

  const insertCheckbox = () => {
    editorRef.current?.focus()
    document.execCommand('insertHTML', false, '<span class="note-cb" style="cursor:pointer;user-select:none" contenteditable="false">☐</span> ')
  }

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0
    const date = d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
    return hasTime ? `${date} ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}` : date
  }

  const handleSave = () => {
    const content = editorRef.current?.innerHTML ?? ''
    if (!content.trim() && !note) { onClose(); return }
    const now = new Date().toISOString()
    const saved: Note = note
      ? { ...note, content, color, dueDate }
      : { id: crypto.randomUUID(), content, x: 100, y: 100, width: 220, height: 190, color, dueDate, createdAt: now, fontSize: 13 }
    onSave(saved)
  }

  return (
    <>
      <div className="editor-overlay" onClick={onClose}>
        <div className="editor-sheet" onClick={e => e.stopPropagation()}>
          <div className="editor-handle" />
          <div className="editor-header">
            <span className="editor-title">{note ? 'Editar nota' : 'Nueva nota'}</span>
            <button className="icon-btn" onClick={onClose}>✕</button>
          </div>

          {/* Formatting toolbar */}
          <div className="fmt-toolbar">
            <button className="fmt-btn" onMouseDown={e => { e.preventDefault(); exec('bold') }} title="Negrita"><b>B</b></button>
            <button className="fmt-btn" onMouseDown={e => { e.preventDefault(); exec('italic') }} title="Cursiva"><i>I</i></button>
            <button className="fmt-btn" onMouseDown={e => { e.preventDefault(); exec('underline') }} title="Subrayado"><u>U</u></button>
            <div className="fmt-sep" />
            <button className="fmt-btn" onMouseDown={e => { e.preventDefault(); insertCheckbox() }} title="Casilla">☐</button>
            <div className="fmt-sep" />
            <button className="fmt-btn" onMouseDown={e => { e.preventDefault(); exec('removeFormat') }} title="Quitar formato">✕</button>
          </div>

          {/* Content editable */}
          <div
            ref={editorRef}
            className="editor-content"
            contentEditable
            suppressContentEditableWarning
            data-placeholder="Escribe tu nota..."
          />

          {/* Color picker */}
          <div className="color-row">
            {COLORS.map(c => (
              <button key={c} className={`color-dot ${c === color ? 'selected' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />
            ))}
          </div>

          {/* Date */}
          <button className="dtp-trigger" onClick={() => setShowDatePicker(true)}>
            {dueDate ? `🗓 ${formatDate(dueDate)}` : '📅 Añadir fecha / recordatorio'}
          </button>

          <div className="editor-actions">
            <button className="btn-secondary" onClick={onClose}>Cancelar</button>
            <button className="btn-primary" onClick={handleSave}>Guardar</button>
          </div>
        </div>
      </div>

      {showDatePicker && (
        <DateTimePicker
          value={dueDate}
          onChange={v => { setDueDate(v); setShowDatePicker(false) }}
          onClose={() => setShowDatePicker(false)}
        />
      )}
    </>
  )
}
