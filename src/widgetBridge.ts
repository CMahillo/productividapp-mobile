// Puente entre la app React y el widget nativo de Android.
//
// Los datos viajan por `@capacitor/preferences`, que en Android escribe en el
// SharedPreferences llamado "CapacitorStorage" con la clave tal cual. El widget
// (AgendaWidgetService.kt) lee de ahí, así que funciona aunque la app esté
// cerrada: nunca hace peticiones de red.
import { Capacitor, registerPlugin } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import { fetchGoogleCalendarEvents } from './googleCalendar'
import { fetchMicrosoftCalendarEvents } from './microsoftCalendar'
import type { Note, CalendarEvent } from './types'

/** Clave de SharedPreferences compartida con el widget nativo. */
export const WIDGET_ITEMS_KEY = 'widget_items'

/** Tope de seguridad de filas: el widget hace scroll, pero no conviene volcar
 *  un JSON enorme en SharedPreferences. */
const MAX_ITEMS = 100

/** Ventana temporal que cubre el widget: de ahora hasta +7 días. */
const WINDOW_DAYS = 7

export interface WidgetItem {
  /** ID de la nota, para abrirla al pulsar la fila del widget.
   *  Vacío en eventos de calendario: no hay navegación específica para ellos. */
  id: string
  title: string
  /** Hora "HH:mm", o null si es de día completo. */
  time: string | null
  source: 'note' | 'google' | 'microsoft'
}

/** Un día de la agenda del widget, con su cabecera y sus items. */
export interface WidgetDayGroup {
  /** "Hoy", "Mañana" o "Mié 13 ago". */
  label: string
  items: WidgetItem[]
}

interface WidgetPluginDef {
  /** Manda el broadcast que fuerza el repintado del widget. */
  refresh(): Promise<void>
}

// Si el plugin nativo no está registrado (PWA web, build antiguo), las llamadas
// fallan y se ignoran: el widget se refrescará solo en su ciclo periódico.
const WidgetPlugin = registerPlugin<WidgetPluginDef>('WidgetPlugin')

function pad(n: number): string { return String(n).padStart(2, '0') }

const DAY_ABBR = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const MONTH_ABBR = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** Días completos entre dos fechas, comparando por fecha civil (inmune al
 *  cambio de hora: restar milisegundos daría 6,96 días en el salto de DST). */
function daysBetween(from: Date, to: Date): number {
  const ms = startOfDay(to).getTime() - startOfDay(from).getTime()
  return Math.round(ms / (24 * 60 * 60 * 1000))
}

/** Cabecera del día: "Hoy", "Mañana" o "Mié 13 ago". */
function dayLabel(day: Date, offset: number): string {
  if (offset === 0) return 'Hoy'
  if (offset === 1) return 'Mañana'
  return `${DAY_ABBR[day.getDay()]!} ${day.getDate()} ${MONTH_ABBR[day.getMonth()]!}`
}

/** Hora "HH:mm", o null si el item ocupa el día entero (la cabecera ya dice
 *  qué día es, así que no hace falta repetirlo en cada fila). */
function timeLabel(date: Date, allDay: boolean): string | null {
  if (allDay) return null
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Construye la agenda del widget: 7 días (hoy → hoy+6) agrupados por día,
 * cada uno con sus items ordenados por hora. Los días sin nada se omiten.
 */
export function buildWidgetDays(
  notes: Note[],
  events: CalendarEvent[],
  now: Date = new Date()
): WidgetDayGroup[] {
  // Desde el inicio del día de hoy: una nota de esta mañana sigue siendo útil.
  const today = startOfDay(now)
  const from = today.getTime()
  const to = from + WINDOW_DAYS * 24 * 60 * 60 * 1000

  // Un cajón por día; el índice es el desplazamiento respecto a hoy.
  const buckets: Array<Array<{ ts: number; item: WidgetItem }>> =
    Array.from({ length: WINDOW_DAYS }, () => [])

  function push(date: Date, offset: number, item: WidgetItem): void {
    if (offset < 0 || offset >= WINDOW_DAYS) return
    buckets[offset]!.push({ ts: date.getTime(), item })
  }

  for (const n of notes) {
    if (n.hidden || !n.dueDate) continue
    const d = new Date(n.dueDate)
    const ts = d.getTime()
    if (Number.isNaN(ts) || ts < from || ts > to) continue
    // Una nota a las 00:00 se trata como "de día completo".
    const allDay = d.getHours() === 0 && d.getMinutes() === 0
    push(d, daysBetween(today, d), {
      id: n.id,
      title: stripHtml(n.content).slice(0, 80) || 'Nota vacía',
      time: timeLabel(d, allDay),
      source: 'note',
    })
  }

  for (const ev of events) {
    if (!ev.start) continue
    const d = new Date(ev.start)
    const ts = d.getTime()
    if (Number.isNaN(ts)) continue
    // Un evento en curso que termina hoy sigue interesando: se ancla a hoy.
    const endTs = ev.end ? new Date(ev.end).getTime() : ts
    if (endTs < from || ts > to) continue
    const offset = Math.max(0, daysBetween(today, d))
    push(d, offset, {
      // Sin id: pulsar un evento de calendario solo abre la app.
      id: '',
      title: (ev.title || '(Sin título)').slice(0, 80),
      time: timeLabel(d, ev.allDay),
      source: ev.source,
    })
  }

  const groups: WidgetDayGroup[] = []
  let total = 0
  for (let offset = 0; offset < WINDOW_DAYS && total < MAX_ITEMS; offset++) {
    const bucket = buckets[offset]!
    if (bucket.length === 0) continue // día vacío: no se pinta cabecera
    bucket.sort((a, b) => a.ts - b.ts)
    const items = bucket.slice(0, MAX_ITEMS - total).map(r => r.item)
    total += items.length
    const day = new Date(today)
    day.setDate(day.getDate() + offset)
    groups.push({ label: dayLabel(day, offset), items })
  }
  return groups
}

/**
 * Persiste la agenda para el widget y le pide que se repinte.
 * No hace nada fuera de un contenedor nativo.
 */
export async function updateWidget(days: WidgetDayGroup[]): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    await Preferences.set({ key: WIDGET_ITEMS_KEY, value: JSON.stringify(days) })
  } catch (e) {
    console.warn('[widget] No se pudieron guardar los items', e)
    return
  }
  try {
    await WidgetPlugin.refresh()
  } catch {
    // Plugin nativo ausente: los datos ya están escritos y el widget los
    // recogerá en su próxima actualización periódica.
  }
}

/** Atajo: construye la agenda a partir de notas + eventos y actualiza el widget. */
export async function syncWidget(notes: Note[], events: CalendarEvent[]): Promise<void> {
  await updateWidget(buildWidgetDays(notes, events))
}

/**
 * Consulta los calendarios para la ventana del widget (hoy → +7 días) y
 * refresca el widget. Fuera de Android no hace nada, así que no gasta
 * peticiones en la PWA web.
 */
export async function refreshWidgetFromSources(notes: Note[]): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const to = new Date(from)
  to.setDate(to.getDate() + WINDOW_DAYS)
  to.setHours(23, 59, 59)

  const [googleEvents, msEvents] = await Promise.all([
    fetchGoogleCalendarEvents(from, to),
    fetchMicrosoftCalendarEvents(from, to),
  ])
  await syncWidget(notes, [...googleEvents, ...msEvents])
}
