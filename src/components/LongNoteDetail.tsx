import type { LongNote } from '../types'

interface Props {
  note: LongNote
  onEdit: () => void
  onDelete: () => void
  onTogglePin: () => void
  onClose: () => void
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function IconPencil() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  )
}

function IconTrash() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
      <path d="M10 11v6M14 11v6"/>
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
    </svg>
  )
}

export default function LongNoteDetail({ note, onEdit, onDelete, onTogglePin, onClose }: Props) {
  const handleDelete = () => {
    if (!window.confirm('¿Eliminar esta nota larga?')) return
    onDelete()
  }

  return (
    <div className="editor-overlay" onClick={onClose}>
      <div className="detail-sheet" style={{ '--note-color': '#e9d5ff' } as React.CSSProperties} onClick={e => e.stopPropagation()}>
        <div className="editor-handle" />

        <div className="detail-header">
          <button className="icon-btn" onClick={onClose}>✕</button>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="icon-btn" onClick={onTogglePin} title={note.pinned ? 'Desfijar' : 'Fijar'} style={{ opacity: note.pinned ? 1 : 0.4 }}>
              📌
            </button>
            <button className="icon-btn icon-btn--edit" onClick={onEdit} title="Editar">
              <IconPencil />
            </button>
            <button className="icon-btn icon-btn--delete" onClick={handleDelete} title="Eliminar">
              <IconTrash />
            </button>
          </div>
        </div>

        <p className="detail-title">{note.title || '(sin título)'}</p>

        <div
          className="detail-body"
          dangerouslySetInnerHTML={{ __html: note.content || '<em style="color:#9ca3af">Nota vacía</em>' }}
        />

        <div className="detail-date" style={{ textTransform: 'capitalize' }}>
          🗓 {formatDate(note.updatedAt)}
        </div>
      </div>
    </div>
  )
}
