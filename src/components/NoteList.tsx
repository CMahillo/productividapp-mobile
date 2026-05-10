import { useState } from 'react'
import type { Note } from '../types'
import NoteCard from './NoteCard'
import NoteDetail from './NoteDetail'
import NoteEditor from './NoteEditor'
import CalendarView from './CalendarView'

type Tab = 'notes' | 'calendar'

interface Props {
  notes: Note[]
  syncing: boolean
  onSave: (notes: Note[]) => void
  onSync: () => void
  onLogout: () => void
}

export default function NoteList({ notes, syncing, onSave, onSync, onLogout }: Props) {
  const [tab, setTab] = useState<Tab>('notes')
  const [query, setQuery] = useState('')
  const [detail, setDetail] = useState<Note | null>(null)
  const [editing, setEditing] = useState<Note | 'new' | null>(null)

  const visible = notes
    .filter(n => !n.hidden)
    .filter(n => !query || stripHtml(n.content).toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  const handleSave = (note: Note) => {
    const idx = notes.findIndex(n => n.id === note.id)
    onSave(idx >= 0 ? notes.map((n, i) => (i === idx ? note : n)) : [...notes, note])
    setEditing(null)
    // Update detail if open
    if (detail?.id === note.id) setDetail(note)
  }

  const handleDelete = (id: string) => {
    onSave(notes.filter(n => n.id !== id))
    setDetail(null)
  }

  const handleToggle = (id: string, content: string) => {
    const updated = notes.map(n => (n.id === id ? { ...n, content } : n))
    onSave(updated)
    const updatedNote = updated.find(n => n.id === id) ?? null
    setDetail(updatedNote)
  }

  const openEdit = (note: Note) => {
    setDetail(null)
    setEditing(note)
  }

  return (
    <div className="app">
      {/* Header */}
      <header className="topbar">
        <span className="topbar-title">{tab === 'notes' ? '📌 Notas' : '📅 Calendario'}</span>
        <div className="topbar-actions">
          {tab === 'notes' && (
            <>
              <button className="icon-btn" onClick={onSync} disabled={syncing} title="Sincronizar">
                {syncing ? <span className="spinner-sm" /> : '↻'}
              </button>
              <button className="icon-btn add-btn" onClick={() => setEditing('new')} title="Nueva nota">+</button>
            </>
          )}
          <button className="icon-btn" onClick={onLogout} title="Cerrar sesión" style={{ fontSize: 14 }}>⏏</button>
        </div>
      </header>

      {/* Content */}
      {tab === 'notes' ? (
        <>
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
              <NoteCard key={note.id} note={note} onTap={() => setDetail(note)} />
            ))}
          </div>
        </>
      ) : (
        <CalendarView
          notes={notes}
          onNoteSelect={setDetail}
        />
      )}

      {/* Bottom tabs */}
      <nav className="tab-bar">
        <button className={`tab-btn ${tab === 'notes' ? 'active' : ''}`} onClick={() => setTab('notes')}>
          <span className="tab-icon">📌</span>
          <span className="tab-label">Notas</span>
        </button>
        <button className={`tab-btn ${tab === 'calendar' ? 'active' : ''}`} onClick={() => setTab('calendar')}>
          <span className="tab-icon">📅</span>
          <span className="tab-label">Calendario</span>
        </button>
      </nav>

      {/* Note detail */}
      {detail && (
        <NoteDetail
          note={detail}
          onEdit={() => openEdit(detail)}
          onDelete={() => handleDelete(detail.id)}
          onToggle={content => handleToggle(detail.id, content)}
          onClose={() => setDetail(null)}
        />
      )}

      {/* Note editor */}
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
