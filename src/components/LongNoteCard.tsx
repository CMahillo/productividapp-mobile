import type { LongNote } from '../types'
import { noteTitle } from '../lib/noteTitle'

interface Props {
  note: LongNote
  onTap: () => void
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function LongNoteCard({ note, onTap }: Props) {
  const text = noteTitle(note)

  return (
    <button className="note-row" onClick={onTap}>
      <span className="note-row-stripe" style={{ background: '#e9d5ff' }} />
      <span className="note-row-body">
        <span className="note-row-text">{text}</span>
        <span className="note-row-date">{formatDate(note.updatedAt)}</span>
      </span>
      {note.pinned && <span className="note-row-pin">📌</span>}
      <span className="note-row-chevron">›</span>
    </button>
  )
}
