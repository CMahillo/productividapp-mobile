import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
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

/** Id reservado para la notificación de prueba de diagnóstico. */
const TEST_NOTIFICATION_ID = 999999

/** Web: no se puede programar en segundo plano, solo timers en memoria. */
const WEB_MAX_DELAY_MS = 24 * 60 * 60 * 1000

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

/** Notas con recordatorio válido y aún en el futuro. */
function pendingReminders(notes: Note[]): { note: Note; due: Date }[] {
  const now = Date.now()
  return notes
    .filter(n => n.dueDate && !n.hidden)
    .map(n => ({ note: n, due: new Date(n.dueDate as string) }))
    .filter(({ due }) => !isNaN(due.getTime()) && due.getTime() > now)
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

      // Diagnóstico: con targetSdk >= 33 el permiso de alarma exacta NO se
      // concede solo. Sin él, el plugin degrada a setAndAllowWhileIdle y el
      // aviso puede retrasarse varios minutos en modo Doze.
      try {
        const exact = await LocalNotifications.checkExactNotificationSetting()
        console.log('[notif] permiso SCHEDULE_EXACT_ALARM:', exact.exact_alarm)
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

/** Reprograma todos los avisos a partir del estado actual de las notas. */
export async function scheduleNotifications(notes: Note[]): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await scheduleNativeNotifications(notes)
  } else {
    scheduleWebNotifications(notes)
  }
}

// ── NATIVO (Android) ────────────────────────────────────────────────────────
// El sistema conserva las alarmas aunque la app esté cerrada, así que en cada
// sincronización se cancela lo pendiente y se reprograma desde cero: es la única
// forma de que borrar una nota o cambiarle la fecha se refleje en el aviso.

/**
 * La notificación de prueba se programa una sola vez por sesión: `loadNotes()`
 * se repite cada 2 minutos y al recuperar el foco, y reprogramarla en cada
 * pasada la desplazaría indefinidamente hacia el futuro.
 */
let testScheduled = false

async function scheduleNativeNotifications(notes: Note[]): Promise<void> {
  try {
    const { notifications: pending } = await LocalNotifications.getPending()
    // La prueba se excluye del barrido: si no, la cancelaría la propia
    // resincronización que ocurre segundos después de programarla.
    const toCancel = pending.filter(n => n.id !== TEST_NOTIFICATION_ID)
    if (toCancel.length > 0) {
      await LocalNotifications.cancel({ notifications: toCancel })
    }
  } catch (e) {
    console.error('[notif] cancel pendientes', e)
  }

  // TEST: notificación de diagnóstico a los 15 s del primer arranque.
  // Sirve para verificar el sistema aunque no haya ninguna nota con dueDate.
  // ELIMINAR EN PRODUCCIÓN.
  if (!testScheduled) {
    testScheduled = true
    const testDate = new Date(Date.now() + 15_000)
    try {
      await LocalNotifications.schedule({
        notifications: [{
          id: TEST_NOTIFICATION_ID,
          title: '🔔 Test ProductividApp',
          body: 'Las notificaciones funcionan correctamente',
          schedule: { at: testDate, allowWhileIdle: true },
          channelId: CHANNEL_ID,
        }],
      })
      console.log('[notif] test programado para', testDate.toISOString())
    } catch (e) {
      console.error('[notif] error al programar el test', e)
    }
  }

  const toSchedule = pendingReminders(notes)
  if (toSchedule.length === 0) {
    console.log('[notif] sin recordatorios futuros que programar')
    return
  }

  try {
    await LocalNotifications.schedule({
      notifications: toSchedule.map(({ note, due }) => ({
        id: noteIdToInt(note.id),
        title: '📌 Recordatorio',
        body: noteExcerpt(note.content) || 'Nota sin contenido',
        schedule: { at: due, allowWhileIdle: true },
        extra: { noteId: note.id },
        channelId: CHANNEL_ID,
      })),
    })
    console.log('[notif] programados', toSchedule.length, 'recordatorios')
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
  pendingReminders(notes).forEach(({ note, due }) => {
    const delay = due.getTime() - now
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
