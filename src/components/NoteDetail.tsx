import { useState } from 'react'
import type { Note } from '../types'
import { isMicrosoftAuthenticated } from '../microsoftAuth'
import { createMicrosoftCalendarEvent } from '../microsoftCalendar'

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

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .trim()
}

function toLocalISO(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`
}

function buildEventDates(note: Note): { start: string; end: string } {
  let startDate: Date
  if (note.dueDate) {
    startDate = new Date(note.dueDate)
    if (startDate.getHours() === 0 && startDate.getMinutes() === 0) startDate.setHours(9, 0, 0, 0)
  } else {
    startDate = new Date()
    startDate.setHours(9, 0, 0, 0)
  }
  const endDate = new Date(startDate.getTime() + 60 * 60 * 1000)
  return { start: toLocalISO(startDate), end: toLocalISO(endDate) }
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

export default function NoteDetail({ note, onEdit, onDelete, onToggle, onClose }: Props) {
  const [outlookStatus, setOutlookStatus] = useState<'idle' | 'creating' | 'success' | 'error'>('idle')
  const [outlookError, setOutlookError] = useState<string | null>(null)
  const msConnected = isMicrosoftAuthenticated()

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

  const handleSendToOutlook = async () => {
    setOutlookStatus('creating')
    setOutlookError(null)

    const plain = stripHtml(note.content)
    const title = plain.split('\n').find(l => l.trim()) ?? 'Nota'
    const { start, end } = buildEventDates(note)

    const result = await createMicrosoftCalendarEvent(title.substring(0, 60), plain, start, end)
    if (result.success) {
      setOutlookStatus('success')
    } else {
      setOutlookError(result.error ?? 'Error desconocido')
      setOutlookStatus('error')
    }
  }

  return (
    <div className="editor-overlay" onClick={onClose}>
      <div className="detail-sheet" style={{ '--note-color': note.color } as React.CSSProperties} onClick={e => e.stopPropagation()}>
        <div className="editor-handle" />

        <div className="detail-header">
          <button className="icon-btn" onClick={onClose}>✕</button>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="icon-btn icon-btn--edit" onClick={onEdit} title="Editar">
              <IconPencil />
            </button>
            <button className="icon-btn icon-btn--delete" onClick={handleDelete} title="Eliminar">
              <IconTrash />
            </button>
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

        {msConnected && (
          <div className="detail-outlook">
            {outlookStatus === 'idle' && (
              <button className="outlook-btn" onClick={handleSendToOutlook}>
                📅 Añadir a Outlook
              </button>
            )}
            {outlookStatus === 'creating' && (
              <span className="outlook-feedback outlook-feedback--creating">Creando evento…</span>
            )}
            {outlookStatus === 'success' && (
              <span className="outlook-feedback outlook-feedback--success">✓ Evento creado en Outlook</span>
            )}
            {outlookStatus === 'error' && (
              <span className="outlook-feedback outlook-feedback--error">✗ {outlookError}</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
