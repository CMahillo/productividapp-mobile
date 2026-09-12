/**
 * Convierte HTML de nota a texto plano, preservando los saltos de bloque
 * (`<br>`, `</p>`, `</div>`, `</li>`) como `\n` para poder extraer la primera
 * línea con `noteTitle()`. Sustituye las copias que había repartidas por el
 * proyecto móvil con pequeñas variaciones entre sí. Espejo de
 * `src/renderer/src/lib/noteTitle.ts` en el escritorio.
 */
export function stripHtml(html: string): string {
  return (html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

function firstLine(text: string): string {
  const line = text.split('\n').find((l) => l.trim())
  return (line ?? '').trim()
}

/**
 * Título corto para representar una nota en listas, tarjetas y filas: el
 * campo `title` explícito si existe, si no la primera línea del contenido,
 * si no un texto de relleno para notas vacías.
 */
export function noteTitle(note: { title?: string; content: string }): string {
  return note.title?.trim() || firstLine(stripHtml(note.content)) || '(nota vacía)'
}
