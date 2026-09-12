import { useState, useEffect, useRef, useCallback } from 'react'
import type { LongNote } from '../types'
import type { Tombstone, NotesSnapshot, MergeableNote } from '../notesMerge'
import { mergeNotes, nowIso } from '../notesMerge'
import { readLongNotes, pushLongNotesToDrive } from '../drive'
import {
  loadCachedLongNotesSnapshot, saveCachedLongNotesSnapshot,
  markLongNotesPendingPush, clearLongNotesPendingPush, hasLongNotesPendingPush
} from '../localCache'
import { stripHtml } from '../lib/noteTitle'
import LongNoteCard from './LongNoteCard'
import LongNoteDetail from './LongNoteDetail'
import LongNoteEditor from './LongNoteEditor'

/**
 * Repositorio de notas largas (§5 PROPUESTA-EVOLUCION.md): quinta pestaña,
 * completamente autónoma — gestiona su propio ciclo de vida de sincronización
 * con Drive (cache-first, merge por updatedAt/tombstones, cola de escritura de
 * 1 elemento), replicando el patrón ya usado para las notas normales en
 * App.tsx pero sin tocar ese código: fichero de Drive, colección de cache y
 * ciclo de estado totalmente aparte. Al montarse/desmontarse con el cambio de
 * pestaña, la sincronización solo corre mientras la pestaña está activa.
 */

const AUTO_SYNC_INTERVAL = 2 * 60 * 1000 // 2 minutos

function toSnapshot(notes: LongNote[], deletedNoteIds: Tombstone[]): NotesSnapshot {
  return { notes: notes as unknown as MergeableNote[], deletedNoteIds }
}

function notesOf(snapshot: NotesSnapshot): LongNote[] {
  return snapshot.notes as unknown as LongNote[]
}

function sortLongNotes(notes: LongNote[]): LongNote[] {
  return [...notes].sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  })
}

export default function LongNotesTab() {
  const [notes, setNotes] = useState<LongNote[]>([])
  const [tombstones, setTombstones] = useState<Tombstone[]>([])
  const [syncing, setSyncing] = useState(false)
  const [query, setQuery] = useState('')
  const [detail, setDetail] = useState<LongNote | null>(null)
  const [editing, setEditing] = useState<LongNote | null | 'new'>(null)

  const notesRef = useRef<LongNote[]>([])
  const tombstonesRef = useRef<Tombstone[]>([])
  const mountedRef = useRef(true)

  useEffect(() => { notesRef.current = notes }, [notes])
  useEffect(() => { tombstonesRef.current = tombstones }, [tombstones])

  const load = useCallback(async () => {
    if (syncing) return
    setSyncing(true)
    try {
      if (await hasLongNotesPendingPush()) {
        const flushed = await pushLongNotesToDrive(toSnapshot(notesRef.current, tombstonesRef.current))
        if (flushed) {
          const flushedNotes = notesOf(flushed)
          notesRef.current = flushedNotes
          tombstonesRef.current = flushed.deletedNoteIds
          if (mountedRef.current) { setNotes(flushedNotes); setTombstones(flushed.deletedNoteIds) }
          void saveCachedLongNotesSnapshot(flushed)
          await clearLongNotesPendingPush()
        }
      }

      const data = await readLongNotes()
      if (data === null) {
        console.warn('[long-notes] lectura fallida; se mantiene lo que hubiera en cache/memoria')
        return
      }
      const merged = mergeNotes(toSnapshot(notesRef.current, tombstonesRef.current), data)
      const mergedNotes = notesOf(merged)
      notesRef.current = mergedNotes
      tombstonesRef.current = merged.deletedNoteIds
      if (mountedRef.current) { setNotes(mergedNotes); setTombstones(merged.deletedNoteIds) }
      void saveCachedLongNotesSnapshot(merged)
    } catch (e) {
      console.error('[long-notes]', e)
    } finally {
      if (mountedRef.current) setSyncing(false)
    }
  }, [syncing])

  useEffect(() => {
    mountedRef.current = true
    let cancelled = false

    async function boot(): Promise<void> {
      const cached = await loadCachedLongNotesSnapshot()
      if (cached && !cancelled) {
        const cachedNotes = notesOf(cached)
        notesRef.current = cachedNotes
        tombstonesRef.current = cached.deletedNoteIds
        setNotes(cachedNotes)
        setTombstones(cached.deletedNoteIds)
      }
      if (!cancelled) void load()
    }
    void boot()

    const id = setInterval(() => { void load() }, AUTO_SYNC_INTERVAL)
    const handleVisibility = (): void => { if (!document.hidden) void load() }
    const handleOnline = (): void => { void load() }
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('online', handleOnline)

    return () => {
      mountedRef.current = false
      cancelled = true
      clearInterval(id)
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('online', handleOnline)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function save(updated: LongNote[]) {
    const previous = notesRef.current
    const now = nowIso()

    const previousById = new Map(previous.map(note => [note.id, note]))
    const stamped = updated.map(note => {
      const before = previousById.get(note.id)
      if (before && JSON.stringify(before) === JSON.stringify(note)) return before
      return { ...note, updatedAt: now }
    })

    const currentIds = new Set(stamped.map(note => note.id))
    const tombs: Tombstone[] = [
      ...tombstonesRef.current.filter(tombstone => !currentIds.has(tombstone.id)),
      ...previous.filter(note => !currentIds.has(note.id)).map(note => ({ id: note.id, deletedAt: now }))
    ]

    notesRef.current = stamped
    tombstonesRef.current = tombs
    setNotes(stamped)
    setTombstones(tombs)
    void saveCachedLongNotesSnapshot(toSnapshot(stamped, tombs))

    const merged = await pushLongNotesToDrive(toSnapshot(stamped, tombs))
    if (!merged) {
      await markLongNotesPendingPush()
      return
    }
    await clearLongNotesPendingPush()
    const mergedNotes = notesOf(merged)
    notesRef.current = mergedNotes
    tombstonesRef.current = merged.deletedNoteIds
    setNotes(mergedNotes)
    setTombstones(merged.deletedNoteIds)
    void saveCachedLongNotesSnapshot(merged)
  }

  const handleSaveFromEditor = (note: LongNote) => {
    const idx = notes.findIndex(n => n.id === note.id)
    void save(idx >= 0 ? notes.map((n, i) => (i === idx ? note : n)) : [...notes, note])
    setEditing(null)
    if (detail?.id === note.id) setDetail(note)
  }

  const handleDelete = (id: string) => {
    void save(notes.filter(n => n.id !== id))
    setDetail(null)
  }

  const handleTogglePin = (note: LongNote) => {
    const updated = { ...note, pinned: !note.pinned, updatedAt: nowIso() }
    void save(notes.map(n => (n.id === note.id ? updated : n)))
    if (detail?.id === note.id) setDetail(updated)
  }

  const visible = sortLongNotes(
    notes.filter(n => {
      if (!query) return true
      const haystack = `${n.title} ${stripHtml(n.content)}`.toLowerCase()
      return haystack.includes(query.toLowerCase())
    })
  )

  return (
    <>
      <div className="search-wrap" style={{ display: 'flex', gap: 8 }}>
        <input
          className="search-input"
          type="search"
          style={{ flex: 1, minWidth: 0, width: 'auto' }}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Buscar notas largas..."
        />
        <button className="icon-btn" onClick={() => void load()} disabled={syncing} title="Sincronizar">
          {syncing ? <span className="spinner-sm" /> : '↻'}
        </button>
        <button className="icon-btn add-btn" onClick={() => setEditing('new')} title="Nueva nota larga">+</button>
      </div>
      <div className="notes-list">
        {visible.length === 0 && (
          <p className="empty-msg">{query ? 'Sin resultados' : 'No hay notas largas. Pulsa + para crear una.'}</p>
        )}
        {visible.map(note => (
          <LongNoteCard key={note.id} note={note} onTap={() => setDetail(note)} />
        ))}
      </div>

      {detail && (
        <LongNoteDetail
          note={detail}
          onEdit={() => { setEditing(detail); setDetail(null) }}
          onDelete={() => handleDelete(detail.id)}
          onTogglePin={() => handleTogglePin(detail)}
          onClose={() => setDetail(null)}
        />
      )}

      {editing !== null && (
        <LongNoteEditor
          note={editing === 'new' ? null : editing}
          onSave={handleSaveFromEditor}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}
