import type { Note } from './types'

const timers = new Map<string, ReturnType<typeof setTimeout>>()

export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  const result = await Notification.requestPermission()
  return result === 'granted'
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

export function scheduleNotifications(notes: Note[]): void {
  if (!('Notification' in window) || Notification.permission !== 'granted') return

  // Clear all existing timers
  timers.forEach(t => clearTimeout(t))
  timers.clear()

  const now = Date.now()

  notes.forEach(note => {
    if (!note.dueDate || note.hidden) return
    const due = new Date(note.dueDate).getTime()
    const delay = due - now

    // Only schedule if due within the next 24 hours and not more than 1 min in the past
    if (delay < -60000 || delay > 24 * 60 * 60 * 1000) return

    const fireAt = Math.max(delay, 0)
    const t = setTimeout(() => {
      const text = stripHtml(note.content) || 'Nota sin contenido'
      new Notification('📌 Recordatorio', {
        body: text.slice(0, 120),
        icon: '/productividapp-mobile/icon.svg',
        tag: note.id,
      })
      timers.delete(note.id)
    }, fireAt)

    timers.set(note.id, t)
  })
}
