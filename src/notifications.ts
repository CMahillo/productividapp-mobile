import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import type { PendingLocalNotificationSchema, LocalNotificationSchema } from '@capacitor/local-notifications'
import { Preferences } from '@capacitor/preferences'
import type { Note } from './types'

/**
 * Canal de notificaciones de Android (8+) para los avisos de vencimiento.
 *
 * Sufijo `-v2`: Android NO permite subir la importancia de un canal ya creado.
 * La v1 se creó con importancia 4 (HIGH) y quedó congelada en los dispositivos
 * que ya la tenían; para aplicar la importancia 5 (URGENT) hay que publicar un
 * canal nuevo y borrar el viejo.
 */
const CHANNEL_ID = 'due-dates-v2'

/** Canal antiguo, se borra en el arranque para no dejarlo huérfano en ajustes. */
const LEGACY_CHANNEL_ID = 'due-dates'

/** Web: no se puede programar en segundo plano, solo timers en memoria. */
const WEB_MAX_DELAY_MS = 24 * 60 * 60 * 1000

/** Clave de Preferences para la antelación configurable (minutos), misma
 *  semántica que `notifications.minutesBefore` en el store de escritorio. El
 *  móvil no tiene aún pantalla de ajustes para escribirla, así que hoy siempre
 *  vale 0 (mismo valor por defecto que escritorio) — queda lista para que una
 *  futura pantalla de ajustes la escriba con esta misma clave. */
const MINUTES_BEFORE_KEY = 'notifications.minutesBefore'

/** Tolerancia al comparar el `at` de una notificación ya programada contra el
 *  deseado: la ida y vuelta por el puente nativo puede redondear milisegundos,
 *  y sin margen se reprogramaría de más en cada sincronización. */
const RESCHEDULE_TOLERANCE_MS = 1000

/**
 * Convierte el id (string) de una nota en un entero de 32 bits positivo.
 * LocalNotifications exige ids numéricos y la correspondencia debe ser estable
 * entre ejecuciones para poder cancelar/reprogramar el aviso de una misma nota.
 */
function noteIdToInt(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = (Math.imul(31, hash) + id.charCodeAt(i)) | 0
  }
  // Math.abs(-2^31) sigue siendo negativo en 32 bits: se descarta el bit de signo.
  return hash === -2147483648 ? 0 : Math.abs(hash)
}

/** Texto plano del contenido HTML de la nota, recortado para el cuerpo del aviso. */
function noteExcerpt(html: string, max = 120): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

/** Antelación configurable (minutos), leída de Preferences. Ver comentario de
 *  `MINUTES_BEFORE_KEY`. */
async function getMinutesBefore(): Promise<number> {
  try {
    const { value } = await Preferences.get({ key: MINUTES_BEFORE_KEY })
    if (!value) return 0
    const n = Number(value)
    return Number.isFinite(n) ? n : 0
  } catch {
    return 0
  }
}

/**
 * Hora efectiva del vencimiento de una nota. `dueDate` se guarda como string
 * local sin zona horaria ('YYYY-MM-DDTHH:MM:SS'); igual que hace el escritorio
 * (ver src/main/index.ts), si la nota no tiene hora concreta (00:00) se avisa
 * a las 9:00 en vez de a medianoche — antes el móvil usaba medianoche tal cual,
 * desalineado con escritorio.
 */
function effectiveDueAt(dueDate: string): Date {
  const [datePart, timePart] = dueDate.split('T')
  const [y, mo, d] = datePart.split('-').map(Number)
  const [h, mi] = (timePart ?? '00:00').split(':').map(Number)
  const hasTime = h !== 0 || mi !== 0
  return hasTime ? new Date(y, mo - 1, d, h, mi) : new Date(y, mo - 1, d, 9, 0)
}

/** Notas con recordatorio válido cuyo aviso (fecha efectiva - antelación)
 *  todavía está en el futuro. */
function pendingReminders(notes: Note[], minutesBeforeMs: number): { note: Note; notifyAt: Date }[] {
  const now = Date.now()
  return notes
    .filter(n => n.dueDate && !n.hidden)
    .map(n => ({ note: n, dueAt: effectiveDueAt(n.dueDate as string) }))
    .filter(({ dueAt }) => !isNaN(dueAt.getTime()))
    .map(({ note, dueAt }) => ({ note, notifyAt: new Date(dueAt.getTime() - minutesBeforeMs) }))
    .filter(({ notifyAt }) => notifyAt.getTime() > now)
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (Capacitor.isNativePlatform()) {
    try {
      // Se llama directamente a requestPermissions(): checkPermissions() puede
      // devolver 'denied' antes de haber preguntado nunca (el plugin lo deriva
      // de areNotificationsEnabled()), y con el cortocircuito anterior el
      // diálogo del sistema no llegaba a mostrarse jamás.
      const { display } = await LocalNotifications.requestPermissions()
      console.log('[notif] permiso POST_NOTIFICATIONS:', display)

      // Alarma exacta: con targetSdk >= 33 el permiso SCHEDULE_EXACT_ALARM NO
      // se concede solo. Sin él, el plugin degrada a setAndAllowWhileIdle y el
      // aviso puede retrasarse varios minutos (u horas) en modo Doze. Antes
      // solo se comprobaba y se registraba en el log; ahora, si no está
      // concedido, se solicita de verdad — en Android 12+ esto abre la
      // pantalla de ajustes del sistema para que el usuario lo active (en
      // versiones anteriores el propio plugin devuelve 'granted' sin más).
      try {
        const exact = await LocalNotifications.checkExactNotificationSetting()
        console.log('[notif] permiso SCHEDULE_EXACT_ALARM:', exact.exact_alarm)
        if (exact.exact_alarm !== 'granted') {
          const changed = await LocalNotifications.changeExactNotificationSetting()
          console.log('[notif] SCHEDULE_EXACT_ALARM tras solicitarlo:', changed.exact_alarm)
        }
      } catch { /* no disponible en versiones antiguas del plugin */ }

      return display === 'granted'
    } catch (e) {
      console.error('[notif] error al pedir permisos nativos', e)
      return false
    }
  }

  if (!('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  const result = await Notification.requestPermission()
  return result === 'granted'
}

/**
 * Registra el canal de notificaciones de Android. Idempotente: crear un canal
 * que ya existe no hace nada. No-op en web. Llamar una vez en el arranque.
 */
export async function createNotificationChannel(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    await LocalNotifications.createChannel({
      id: CHANNEL_ID,
      name: 'Fechas de vencimiento',
      description: 'Avisos cuando una nota llega a su fecha y hora',
      importance: 5, // URGENT: aviso emergente con sonido
      visibility: 1, // PUBLIC
      vibration: true,
      sound: 'default',
    })
    console.log('[notif] canal creado:', CHANNEL_ID)
  } catch (e) {
    console.error('[notif] createChannel', e)
  }

  // Limpiar el canal v1 (importancia HIGH) para que no quede duplicado.
  try {
    await LocalNotifications.deleteChannel({ id: LEGACY_CHANNEL_ID })
  } catch { /* no existía */ }
}

/** Reprograma los avisos a partir del estado actual de las notas. */
export async function scheduleNotifications(notes: Note[]): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await scheduleNativeNotifications(notes)
  } else {
    scheduleWebNotifications(notes)
  }
}

// ── NATIVO (Android) ────────────────────────────────────────────────────────
// El sistema conserva las alarmas aunque la app esté cerrada. Antes se
// cancelaba TODO y se reprogramaba TODO en cada sincronización (cada 2 min):
// generaba una ventana ciega entre cancelar y reprogramar y era más churn del
// necesario. Ahora se compara lo ya pendiente contra lo que debería haber
// (por nota + fecha efectiva + antelación) y solo se toca lo que cambió.

/** Lee de forma robusta el instante (ms) de un `schedule.at` ya programado:
 *  según la versión del plugin y el puente nativo puede llegar como `Date`,
 *  ISO string o epoch en milisegundos. */
function scheduledAtMs(pending: PendingLocalNotificationSchema): number | null {
  const at = pending.schedule?.at as unknown
  if (at instanceof Date) return at.getTime()
  if (typeof at === 'number') return at
  if (typeof at === 'string') {
    const ms = Date.parse(at)
    return Number.isNaN(ms) ? null : ms
  }
  return null
}

async function scheduleNativeNotifications(notes: Note[]): Promise<void> {
  const minutesBefore = await getMinutesBefore()
  const reminderMs = minutesBefore * 60 * 1000

  const desired = pendingReminders(notes, reminderMs)
  const desiredById = new Map(desired.map(d => [noteIdToInt(d.note.id), d]))

  let pending: PendingLocalNotificationSchema[] = []
  try {
    pending = (await LocalNotifications.getPending()).notifications
  } catch (e) {
    console.error('[notif] getPending', e)
  }
  const pendingById = new Map(pending.map(p => [p.id, p]))

  const toCancel: { id: number }[] = []
  for (const [id] of pendingById) {
    if (!desiredById.has(id)) toCancel.push({ id })
  }

  const toSchedule: LocalNotificationSchema[] = []
  for (const [id, { note, notifyAt }] of desiredById) {
    const already = pendingById.get(id)
    const currentAtMs = already ? scheduledAtMs(already) : null
    if (already && currentAtMs !== null && Math.abs(currentAtMs - notifyAt.getTime()) <= RESCHEDULE_TOLERANCE_MS) {
      continue // ya está programado para la hora correcta, no tocar
    }
    if (already) toCancel.push({ id }) // reprogramar: cancelar la versión vieja primero
    toSchedule.push({
      id,
      title: '📌 Recordatorio',
      body: noteExcerpt(note.content) || 'Nota sin contenido',
      schedule: { at: notifyAt, allowWhileIdle: true },
      extra: { noteId: note.id },
      channelId: CHANNEL_ID,
    })
  }

  if (toCancel.length > 0) {
    try {
      await LocalNotifications.cancel({ notifications: toCancel })
    } catch (e) {
      console.error('[notif] cancel diff', e)
    }
  }

  if (toSchedule.length === 0) {
    console.log('[notif] sin cambios en los recordatorios pendientes')
    return
  }

  try {
    await LocalNotifications.schedule({ notifications: toSchedule })
    console.log('[notif] programados/actualizados', toSchedule.length, 'recordatorios')
  } catch (e) {
    console.error('[notif] schedule nativo', e)
  }
}

// ── WEB (PWA) ───────────────────────────────────────────────────────────────

const webTimers = new Map<string, ReturnType<typeof setTimeout>>()

function scheduleWebNotifications(notes: Note[]): void {
  if (!('Notification' in window) || Notification.permission !== 'granted') return

  webTimers.forEach(t => clearTimeout(t))
  webTimers.clear()

  const now = Date.now()
  pendingReminders(notes, 0).forEach(({ note, notifyAt }) => {
    const delay = notifyAt.getTime() - now
    // Los timers solo viven mientras la pestaña esté abierta: no tiene sentido
    // programar más allá de un día.
    if (delay > WEB_MAX_DELAY_MS) return

    const t = setTimeout(() => {
      new Notification('📌 Recordatorio', {
        body: noteExcerpt(note.content) || 'Nota sin contenido',
        icon: '/productividapp-mobile/icon.svg',
        tag: note.id,
      })
      webTimers.delete(note.id)
    }, delay)

    webTimers.set(note.id, t)
  })
}
