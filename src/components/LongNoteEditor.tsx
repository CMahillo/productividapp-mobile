import { useState, useRef, useEffect } from 'react'
import type { LongNote } from '../types'

interface Props {
  note: LongNote | null
  onSave: (note: LongNote) => void
  onClose: () => void
}

export default function LongNoteEditor({ note, onSave, onClose }: Props) {
  const [title, setTitle] = useState(note?.title ?? '')
  const [pinned, setPinned] = useState(!!note?.pinned)
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

  const handleSave = () => {
    const content = (editorRef.current?.innerHTML ?? '').replace(/&amp;nbsp;/g, ' ').replace(/&nbsp;/g, ' ')
    const trimmedTitle = title.trim()
    if (!content.trim() && !trimmedTitle && !note) { onClose(); return }
    const now = new Date().toISOString()
    const saved: LongNote = note
      ? { ...note, title: trimmedTitle || 'Sin título', content, pinned, updatedAt: now }
      : { id: crypto.randomUUID(), title: trimmedTitle || 'Sin título', content, pinned, createdAt: now, updatedAt: now }
    onSave(saved)
  }

  return (
    <div className="editor-overlay" onClick={onClose}>
      <div className="editor-sheet" onClick={e => e.stopPropagation()}>
        <div className="editor-handle" />
        <div className="editor-header">
          <span className="editor-title">{note ? 'Editar nota larga' : 'Nueva nota larga'}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className="icon-btn"
              onClick={() => setPinned(p => !p)}
              title={pinned ? 'Desfijar' : 'Fijar'}
              style={{ opacity: pinned ? 1 : 0.4 }}
            >📌</button>
            <button className="icon-btn" onClick={onClose}>✕</button>
          </div>
        </div>

        {/* Title */}
        <input
          className="editor-title-input"
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Título"
        />

        {/* Formatting toolbar */}
        <div className="fmt-toolbar">
          <button className="fmt-btn" onMouseDown={e => { e.preventDefault(); exec('bold') }} title="Negrita"><b>B</b></button>
          <button className="fmt-btn" onMouseDown={e => { e.preventDefault(); exec('italic') }} title="Cursiva"><i>I</i></button>
          <button className="fmt-btn" onMouseDown={e => { e.preventDefault(); exec('underline') }} title="Subrayado"><u>U</u></button>
          <div className="fmt-sep" />
          <button className="fmt-btn" onMouseDown={e => { e.preventDefault(); exec('removeFormat') }} title="Quitar formato">✕</button>
        </div>

        {/* Content editable */}
        <div
          ref={editorRef}
          className="editor-content"
          contentEditable
          suppressContentEditableWarning
          data-placeholder="Escribe aquí..."
          style={{ minHeight: 260 }}
        />

        <div className="editor-actions">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" onClick={handleSave}>Guardar</button>
        </div>
      </div>
    </div>
  )
}
