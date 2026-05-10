import type { Note } from '../types'

interface Props {
  note: Note
  onEdit: () => void
  onDelete: () => void
  onToggle: (content: string) => void
  onClose: () => void
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0
  const date = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
  return hasTime ? `${date}, ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}` : date
}

export default function NoteDetail({ note, onEdit, onDelete, onToggle, onClose }: Props) {
  const handleCheckbox = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    const cb = target.classList.contains('note-cb') ? target : target.closest<HTMLElement>('.note-cb')
    if (!cb) return
    const newContent = note.content.replace(cb.outerHTML,
      cb.textContent === '☐'
        ? cb.outerHTML.replace('☐', '☑')
        : cb.outerHTML.replace('☑', '☐')
    )
    onToggle(newContent)
  }

  const handleDelete = () => {
    if (!window.confirm('¿Eliminar esta nota?')) return
    onDelete()
  }

  return (
    <div className="editor-overlay" onClick={onClose}>
      <div className="detail-sheet" style={{ '--note-color': note.color } as React.CSSProperties} onClick={e => e.stopPropagation()}>
        <div className="editor-handle" />

        <div className="detail-header">
          <button className="icon-btn" onClick={onClose}>✕</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="note-btn" onClick={onEdit}>Editar</button>
            <button className="note-btn danger" onClick={handleDelete}>Eliminar</button>
          </div>
        </div>

        <div
          className="detail-body"
          dangerouslySetInnerHTML={{ __html: note.content || '<em style="color:#9ca3af">Nota vacía</em>' }}
          onClick={handleCheckbox}
        />

        {note.dueDate && (
          <div className="detail-date">
            🗓 <span style={{ textTransform: 'capitalize' }}>{formatDate(note.dueDate)}</span>
          </div>
        )}
      </div>
    </div>
  )
}
