import { useState, useMemo, useEffect } from 'react'
import type { Note, QuickItem } from '../types'
import { refreshWidgetFromSources } from '../widgetBridge'
import NoteCard from './NoteCard'
import NoteDetail from './NoteDetail'
import NoteEditor from './NoteEditor'
import CalendarView from './CalendarView'
import QuickPanelView from './QuickPanelView'
import BoardView from './BoardView'

type Tab = 'notes' | 'calendar' | 'board' | 'quick'

/** Cada cuánto se refrescan los datos del widget de Android. */
const WIDGET_REFRESH_INTERVAL = 2 * 60 * 1000

interface Props {
  notes: Note[]
  quickItems: QuickItem[]
  syncing: boolean
  onSave: (notes: Note[]) => void
  onSync: () => void
  onLogout: () => void
  /** Sube cada vez que el botón "+" del widget de Android pide una nota nueva. */
  newNoteRequest?: number
  /** Avisa a App de que la petición ya se ha atendido, para no repetirla. */
  onNewNoteHandled?: () => void
  /** Nota que pide abrir una fila del widget de Android. `seq` sube en cada
   *  pulsación, para que repetir la misma nota vuelva a abrir el editor. */
  openNoteRequest?: { id: string; seq: number } | null
  /** Avisa a App de que la petición ya se ha atendido. */
  onOpenNoteHandled?: () => void
}

export default function NoteList({
  notes, quickItems, syncing, onSave, onSync, onLogout,
  newNoteRequest = 0, onNewNoteHandled,
  openNoteRequest = null, onOpenNoteHandled
}: Props) {
  const [tab, setTab] = useState<Tab>('notes')
  const [query, setQuery] = useState('')
  const [detail, setDetail] = useState<Note | null>(null)
  const [editState, setEditState] = useState<{ note: Note | null; defaultDueDate?: string } | null>(null)

  // Petición de nota nueva desde el widget. Funciona igual en arranque en frío
  // (el contador ya vale >0 cuando este componente se monta) que con la app
  // abierta (el contador sube y dispara el efecto).
  useEffect(() => {
    if (newNoteRequest <= 0) return
    setTab('notes')
    setDetail(null)
    setEditState({ note: null })
    onNewNoteHandled?.()
  }, [newNoteRequest])

  // Petición de abrir una nota concreta desde el widget. Igual que la anterior,
  // funciona tanto en arranque en frío (la prop ya viene puesta al montar) como
  // con la app abierta. Si la nota ya no existe se descarta la petición.
  useEffect(() => {
    if (!openNoteRequest) return
    const note = notes.find(n => n.id === openNoteRequest.id)
    if (note) {
      setTab('notes')
      setDetail(null)
      setEditState({ note })
    }
    onOpenNoteHandled?.()
  }, [openNoteRequest?.seq])

  // Alimenta el widget de Android: al arrancar, al cambiar las notas, cada
  // 2 min y al volver a primer plano. Este componente está siempre montado,
  // así que el widget se rellena aunque el usuario no abra el calendario.
  useEffect(() => {
    let cancelled = false
    const feed = (): void => {
      if (cancelled) return
      void refreshWidgetFromSources(notes).catch(e => console.warn('[widget]', e))
    }
    feed()
    const id = setInterval(feed, WIDGET_REFRESH_INTERVAL)
    const onVisible = (): void => { if (!document.hidden) feed() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [notes])

  const availableLabels = useMemo(
    () => [...new Set(notes.map(n => n.label).filter((l): l is string => !!l))],
    [notes]
  )

  const visible = notes
    .filter(n => !n.hidden)
    .filter(n => !query || stripHtml(n.content).toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  const handleSave = (note: Note) => {
    const idx = notes.findIndex(n => n.id === note.id)
    onSave(idx >= 0 ? notes.map((n, i) => (i === idx ? note : n)) : [...notes, note])
    setEditState(null)
    if (detail?.id === note.id) setDetail(note)
  }

  const handleNewNoteForDate = (date: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0')
    const dueDate = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T09:00:00`
    setEditState({ note: null, defaultDueDate: dueDate })
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
    setEditState({ note })
  }

  return (
    <div className="app">
      {/* Header */}
      <header className="topbar">
        <span className="topbar-title">
          {tab === 'notes' ? '📌 Notas' : tab === 'calendar' ? '📅 Calendario' : tab === 'board' ? '🗂 Tablero' : '⚡ Rápido'}
        </span>
        <div className="topbar-actions">
          {tab === 'notes' && (
            <>
              <button className="icon-btn" onClick={onSync} disabled={syncing} title="Sincronizar">
                {syncing ? <span className="spinner-sm" /> : '↻'}
              </button>
              <button className="icon-btn add-btn" onClick={() => setEditState({ note: null })} title="Nueva nota">+</button>
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
      ) : tab === 'calendar' ? (
        <CalendarView
          notes={notes}
          onNoteSelect={setDetail}
          onSave={onSave}
          onNewNote={handleNewNoteForDate}
        />
      ) : tab === 'board' ? (
        <BoardView notes={notes} onSave={onSave} />
      ) : (
        <QuickPanelView items={quickItems} />
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
        <button className={`tab-btn ${tab === 'board' ? 'active' : ''}`} onClick={() => setTab('board')}>
          <span className="tab-icon">🗂</span>
          <span className="tab-label">Tablero</span>
        </button>
        <button className={`tab-btn ${tab === 'quick' ? 'active' : ''}`} onClick={() => setTab('quick')}>
          <span className="tab-icon">⚡</span>
          <span className="tab-label">Rápido</span>
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
      {editState !== null && (
        <NoteEditor
          note={editState.note}
          labels={availableLabels}
          defaultDueDate={editState.defaultDueDate}
          onSave={handleSave}
          onClose={() => setEditState(null)}
        />
      )}
    </div>
  )
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}
