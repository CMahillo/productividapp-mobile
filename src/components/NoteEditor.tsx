import { useState, useRef, useEffect } from 'react'
import type { Note } from '../types'
import DateTimePicker from './DateTimePicker'

const COLORS = [
  '#fef9c3', '#bbf7d0', '#bfdbfe', '#fecaca',
  '#e9d5ff', '#fed7aa', '#f0fdf4', '#f1f5f9'
]

interface Props {
  note: Note | null
  labels: string[]
  onSave: (note: Note) => void
  onClose: () => void
}

export default function NoteEditor({ note, labels, onSave, onClose }: Props) {
  const [color, setColor] = useState(note?.color ?? '#fef9c3')
  const [dueDate, setDueDate] = useState<string | undefined>(note?.dueDate)
  const [label, setLabel] = useState<string | undefined>(note?.label)
  const [newLabel, setNewLabel] = useState('')
  const [showDatePicker, setShowDatePicker] = useState(false)
  const editorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.innerHTML = note?.content ?? ''
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

  const toggleCheckbox = () => {
    const editor = editorRef.current
    if (!editor) return
    editor.focus()
    const sel = window.getSelection()
    let anchor: Node | null = sel?.focusNode ?? null
    while (anchor && anchor.parentNode !== editor) anchor = anchor.parentNode
    let prev: Node | null = anchor ? anchor.previousSibling : null
    while (prev && prev.nodeName !== 'BR') prev = prev.previousSibling
    const lineStart: Node | null = prev ? prev.nextSibling : editor.firstChild
    if (
      lineStart?.nodeType === Node.ELEMENT_NODE &&
      (lineStart as Element).classList.contains('note-cb')
    ) {
      const next = lineStart.nextSibling
      editor.removeChild(lineStart)
      if (next?.nodeType === Node.TEXT_NODE) {
        const t = next as Text
        if (t.data.startsWith(' ')) {
          if (t.data.length === 1) editor.removeChild(t)
          else t.data = t.data.slice(1)
        }
      }
    } else {
      const cbSpan = document.createElement('span')
      cbSpan.className = 'note-cb'
      cbSpan.setAttribute('style', 'cursor:pointer;user-select:none')
      cbSpan.setAttribute('contenteditable', 'false')
      cbSpan.textContent = '☐'
      const space = document.createTextNode(' ')
      if (lineStart && lineStart.parentNode === editor) {
        editor.insertBefore(cbSpan, lineStart)
        editor.insertBefore(space, lineStart)
      } else {
        editor.appendChild(cbSpan)
        editor.appendChild(space)
      }
    }
  }

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0
    const date = d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
    return hasTime ? `${date} ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}` : date
  }

  const handleSave = () => {
    const content = (editorRef.current?.innerHTML ?? '').replace(/&amp;nbsp;/g, ' ').replace(/&nbsp;/g, ' ')
    if (!content.trim() && !note) { onClose(); return }
    const now = new Date().toISOString()
    const saved: Note = note
      ? { ...note, content, color, dueDate, label }
      : { id: crypto.randomUUID(), content, x: 100, y: 100, width: 220, height: 190, color, dueDate, label, createdAt: now, fontSize: 13 }
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
            <button className="fmt-btn" onMouseDown={e => { e.preventDefault(); toggleCheckbox() }} title="Casilla">☐</button>
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
            onKeyDown={(e) => {
              if (e.key === 'Enter' && editorRef.current) {
                e.preventDefault()
                const sel = window.getSelection()
                if (sel && sel.rangeCount > 0) {
                  let node: Node | null = sel.getRangeAt(0).startContainer
                  while (node && node !== editorRef.current && node.parentNode !== editorRef.current) {
                    node = node.parentNode
                  }
                  let lineFirst: Node | null = null
                  if (node && node !== editorRef.current) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                      lineFirst = (node as Element).firstChild
                    } else {
                      let prev: Node | null = node.previousSibling
                      while (prev && prev.nodeName !== 'BR') prev = prev.previousSibling
                      lineFirst = prev ? prev.nextSibling : editorRef.current.firstChild
                    }
                  }
                  if (lineFirst?.nodeType === Node.ELEMENT_NODE && (lineFirst as Element).classList?.contains('note-cb')) {
                    document.execCommand('insertHTML', false, '<br><span class="note-cb" style="cursor:pointer;user-select:none" contenteditable="false">☐</span> ')
                  } else {
                    document.execCommand('insertLineBreak')
                  }
                } else {
                  document.execCommand('insertLineBreak')
                }
              }
            }}
          />

          {/* Color picker */}
          <div className="color-row">
            {COLORS.map(c => (
              <button key={c} className={`color-dot ${c === color ? 'selected' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />
            ))}
          </div>

          {/* Label selector */}
          <div className="label-section">
            <div className="label-row">
              <button
                className={`label-chip ${!label ? 'active' : ''}`}
                onClick={() => setLabel(undefined)}
              >Sin etiqueta</button>
              {labels.map(l => (
                <button
                  key={l}
                  className={`label-chip ${label === l ? 'active' : ''}`}
                  onClick={() => setLabel(label === l ? undefined : l)}
                >{l}</button>
              ))}
            </div>
            <div className="label-new-row">
              <input
                className="label-new-input"
                type="text"
                placeholder="Nueva etiqueta..."
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && newLabel.trim()) {
                    setLabel(newLabel.trim())
                    setNewLabel('')
                  }
                }}
              />
              {newLabel.trim() && (
                <button
                  className="label-new-btn"
                  onClick={() => { setLabel(newLabel.trim()); setNewLabel('') }}
                >Usar</button>
              )}
            </div>
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
