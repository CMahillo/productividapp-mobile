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
// Esta cache guarda, en @capacitor/preferences, la última copia buena de las
// notas (para pintar algo de inmediato al arrancar, con o sin red) y una
// marca de "hay cambios sin subir" para reintentar `pushNotesToDrive()` en el
// siguiente evento de conectividad o al volver a abrir/enfocar la app — no
// hace falta una cola de varias operaciones en orden: como cada snapshot ya
// contiene el estado completo, "el último estado local válido, reintentado
// hasta que suba" es suficiente.
// ─────────────────────────────────────────────────────────────────────────────

const SNAPSHOT_KEY = 'cache.notes_snapshot.v1'
const QUICK_ITEMS_KEY = 'cache.quick_items.v1'
const PENDING_PUSH_KEY = 'cache.notes_pending_push.v1'

export async function loadCachedSnapshot(): Promise<NotesSnapshot | null> {
  try {
    const { value } = await Preferences.get({ key: SNAPSHOT_KEY })
    if (!value) return null
    return JSON.parse(value) as NotesSnapshot
  } catch (e) {
    console.error('[cache] loadCachedSnapshot', e)
    return null
  }
}

export async function saveCachedSnapshot(snapshot: NotesSnapshot): Promise<void> {
  try {
    await Preferences.set({ key: SNAPSHOT_KEY, value: JSON.stringify(snapshot) })
  } catch (e) {
    console.error('[cache] saveCachedSnapshot', e)
  }
}

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

/** Marca que el snapshot cacheado tiene cambios que aún no han subido a Drive. */
export async function markPendingPush(): Promise<void> {
  try {
    await Preferences.set({ key: PENDING_PUSH_KEY, value: '1' })
  } catch (e) {
    console.error('[cache] markPendingPush', e)
  }
}

export async function clearPendingPush(): Promise<void> {
  try {
    await Preferences.remove({ key: PENDING_PUSH_KEY })
  } catch (e) {
    console.error('[cache] clearPendingPush', e)
  }
}

export async function hasPendingPush(): Promise<boolean> {
  try {
    const { value } = await Preferences.get({ key: PENDING_PUSH_KEY })
    return value === '1'
  } catch (e) {
    console.error('[cache] hasPendingPush', e)
    return false
  }
}
