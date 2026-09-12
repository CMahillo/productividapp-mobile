import { Preferences } from '@capacitor/preferences'
import type { NotesSnapshot } from './notesMerge'
import type { QuickItem } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// CACHE LOCAL OFFLINE + COLA DE ESCRITURA DE 1 ELEMENTO
//
// El móvil no tenía ninguna persistencia local: `loadNotes()` sustituía el
// estado en memoria por lo que hubiera en Drive, así que sin red la app no
// tenía nada que mostrar y una escritura fallida se perdía en silencio.
//
// Esta cache guarda, en @capacitor/preferences, la última copia buena de cada
// colección tipo notas (para pintar algo de inmediato al arrancar, con o sin
// red) y una marca de "hay cambios sin subir" para reintentar el push en el
// siguiente evento de conectividad o al volver a abrir/enfocar la app — no
// hace falta una cola de varias operaciones en orden: como cada snapshot ya
// contiene el estado completo, "el último estado local válido, reintentado
// hasta que suba" es suficiente.
//
// Genérico sobre la clave de Preferences: las notas normales y las notas
// largas del repositorio (§5 PROPUESTA-EVOLUCION.md) comparten esta lógica,
// cada una con su propia clave — nunca se mezclan en el mismo registro.
// ─────────────────────────────────────────────────────────────────────────────

const SNAPSHOT_KEY = 'cache.notes_snapshot.v1'
const QUICK_ITEMS_KEY = 'cache.quick_items.v1'
const PENDING_PUSH_KEY = 'cache.notes_pending_push.v1'

const LONG_NOTES_SNAPSHOT_KEY = 'cache.long_notes_snapshot.v1'
const LONG_NOTES_PENDING_PUSH_KEY = 'cache.long_notes_pending_push.v1'

async function loadSnapshot(key: string): Promise<NotesSnapshot | null> {
  try {
    const { value } = await Preferences.get({ key })
    if (!value) return null
    return JSON.parse(value) as NotesSnapshot
  } catch (e) {
    console.error(`[cache] loadSnapshot(${key})`, e)
    return null
  }
}

async function saveSnapshot(key: string, snapshot: NotesSnapshot): Promise<void> {
  try {
    await Preferences.set({ key, value: JSON.stringify(snapshot) })
  } catch (e) {
    console.error(`[cache] saveSnapshot(${key})`, e)
  }
}

/** Marca que el snapshot cacheado tiene cambios que aún no han subido a Drive. */
async function markPending(key: string): Promise<void> {
  try {
    await Preferences.set({ key, value: '1' })
  } catch (e) {
    console.error(`[cache] markPending(${key})`, e)
  }
}

async function clearPending(key: string): Promise<void> {
  try {
    await Preferences.remove({ key })
  } catch (e) {
    console.error(`[cache] clearPending(${key})`, e)
  }
}

async function hasPending(key: string): Promise<boolean> {
  try {
    const { value } = await Preferences.get({ key })
    return value === '1'
  } catch (e) {
    console.error(`[cache] hasPending(${key})`, e)
    return false
  }
}

export const loadCachedSnapshot = (): Promise<NotesSnapshot | null> => loadSnapshot(SNAPSHOT_KEY)
export const saveCachedSnapshot = (snapshot: NotesSnapshot): Promise<void> => saveSnapshot(SNAPSHOT_KEY, snapshot)
export const markPendingPush = (): Promise<void> => markPending(PENDING_PUSH_KEY)
export const clearPendingPush = (): Promise<void> => clearPending(PENDING_PUSH_KEY)
export const hasPendingPush = (): Promise<boolean> => hasPending(PENDING_PUSH_KEY)

/** Notas largas del repositorio: misma cache, misma cola de 1 elemento, clave
 *  de Preferences aparte — nunca comparten registro con las notas normales. */
export const loadCachedLongNotesSnapshot = (): Promise<NotesSnapshot | null> => loadSnapshot(LONG_NOTES_SNAPSHOT_KEY)
export const saveCachedLongNotesSnapshot = (snapshot: NotesSnapshot): Promise<void> =>
  saveSnapshot(LONG_NOTES_SNAPSHOT_KEY, snapshot)
export const markLongNotesPendingPush = (): Promise<void> => markPending(LONG_NOTES_PENDING_PUSH_KEY)
export const clearLongNotesPendingPush = (): Promise<void> => clearPending(LONG_NOTES_PENDING_PUSH_KEY)
export const hasLongNotesPendingPush = (): Promise<boolean> => hasPending(LONG_NOTES_PENDING_PUSH_KEY)

export async function loadCachedQuickItems(): Promise<QuickItem[] | null> {
  try {
    const { value } = await Preferences.get({ key: QUICK_ITEMS_KEY })
    if (!value) return null
    return JSON.parse(value) as QuickItem[]
  } catch (e) {
    console.error('[cache] loadCachedQuickItems', e)
    return null
  }
}

export async function saveCachedQuickItems(items: QuickItem[]): Promise<void> {
  try {
    await Preferences.set({ key: QUICK_ITEMS_KEY, value: JSON.stringify(items) })
  } catch (e) {
    console.error('[cache] saveCachedQuickItems', e)
  }
}
