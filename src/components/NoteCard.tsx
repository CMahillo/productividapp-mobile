import type { Note } from '../types'
import { noteTitle } from '../lib/noteTitle'

interface Props {
  note: Note
  onTap: () => void
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0
  const date = d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
  return hasTime ? `${date} · ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}` : date
}

export default function NoteCard({ note, onTap }: Props) {
  const text = noteTitle(note)

  return (
    <button className="note-row" onClick={onTap}>
      <span className="note-row-stripe" style={{ background: note.color }} />
      <span className="note-row-body">
        <span className="note-row-text">{text}</span>
        {note.dueDate && (
          <span className="note-row-date">🗓 {formatDate(note.dueDate)}</span>
        )}
      </span>
      {note.pinned && <span className="note-row-pin">📌</span>}
      <span className="note-row-chevron">›</span>
    </button>
  )
}
