import { useState } from 'react'
import type { Note } from '../types'
import NoteCard from './NoteCard'
import NoteEditor from './NoteEditor'

interface Props {
  notes: Note[]
  syncing: boolean
  onSave: (notes: Note[]) => void
  onSync: () => void
  onLogout: () => void
}

export default function NoteList({ notes, syncing, onSave, onSync, onLogout }: Props) {
  const [editing, setEditing] = useState<Note | 'new' | null>(null)
  const [query, setQuery] = useState('')

  const visible = notes
    .filter(n => !n.hidden)
    .filter(n => !query || stripHtml(n.content).toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  const handleSave = (note: Note) => {
    const idx = notes.findIndex(n => n.id === note.id)
    onSave(idx >= 0 ? notes.map((n, i) => (i === idx ? note : n)) : [...notes, note])
    setEditing(null)
  }

  const handleDelete = (id: string) => {
    if (!window.confirm('¿Eliminar esta nota?')) return
    onSave(notes.filter(n => n.id !== id))
  }

  const handleToggle = (id: string, content: string) => {
    onSave(notes.map(n => (n.id === id ? { ...n, content } : n)))
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="topbar-title">📌 Notas</span>
        <div className="topbar-actions">
          <button className="icon-btn" onClick={onSync} disabled={syncing} title="Sincronizar">
            {syncing ? <span className="spinner-sm" /> : '↻'}
          </button>
          <button className="icon-btn add-btn" onClick={() => setEditing('new')} title="Nueva nota">+</button>
          <button className="icon-btn" onClick={onLogout} title="Cerrar sesión" style={{ fontSize: 14 }}>⏏</button>
        </div>
      </header>

      <div className="search-wrap">
        <input
          className="search-input"
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Buscar notas..."
        />
      </div>

      <div className="notes-list">
        {visible.length === 0 && (
          <p className="empty-msg">{query ? 'Sin resultados' : 'No hay notas. Pulsa + para crear una.'}</p>
        )}
        {visible.map(note => (
          <NoteCard
            key={note.id}
            note={note}
            onEdit={() => setEditing(note)}
            onDelete={() => handleDelete(note.id)}
            onToggle={content => handleToggle(note.id, content)}
          />
        ))}
      </div>

      {editing !== null && (
        <NoteEditor
          note={editing === 'new' ? null : editing}
          onSave={handleSave}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}
