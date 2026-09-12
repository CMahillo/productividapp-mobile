export interface Note {
  id: string
  /** Título corto opcional. Si no está, el título se deriva de la primera
   *  línea del contenido (ver `lib/noteTitle.ts`). Notas antiguas no lo
   *  tienen: queda `undefined` y el fallback se encarga. */
  title?: string
  content: string
  x: number
  y: number
  color: string
  width: number
  height: number
  fontSize?: number
  dueDate?: string
  label?: string
  hidden?: boolean
  pinned?: boolean
  createdAt: string
  /** Marca de última modificación (ISO). Es lo que decide quién gana en el merge
   *  con Drive, así que hay que tocarlo en CUALQUIER cambio de la nota. */
  updatedAt: string
}

export interface QuickItem {
  id: string
  label: string
  content: string
  type: 'text' | 'link' | 'file'
  category: string
}

export interface CalendarEvent {
  id: string
  title: string
  start: string   // ISO 8601
  end: string     // ISO 8601
  allDay: boolean
  source: 'google' | 'microsoft'
  webLink?: string
}
