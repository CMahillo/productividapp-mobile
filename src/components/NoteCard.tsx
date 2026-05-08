import type { Note } from '../types'

interface Props {
  note: Note
  onEdit: () => void
  onDelete: () => void
  onToggle: (content: string) => void
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0
  const date = d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })
  return hasTime ? `${date} ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}` : date
}

export default function NoteCard({ note, onEdit, onDelete, onToggle }: Props) {
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
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

  return (
    <div className="note-card" style={{ '--note-color': note.color } as React.CSSProperties}>
      <div className="note-card-inner">
        {note.pinned && <span className="pin-badge">📌</span>}
        <div
          className="note-body"
          dangerouslySetInnerHTML={{ __html: note.content || '<em style="color:#9ca3af">Nota vacía</em>' }}
          onClick={handleClick}
        />
        {note.dueDate && (
          <div className="note-date">🗓 {formatDate(note.dueDate)}</div>
        )}
        <div className="note-footer">
          <button className="note-btn" onClick={onEdit}>Editar</button>
          <button className="note-btn danger" onClick={onDelete}>Eliminar</button>
        </div>
      </div>
    </div>
  )
}
