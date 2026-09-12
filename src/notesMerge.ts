// ─────────────────────────────────────────────────────────────────────────────
// MERGE DE NOTAS — COPIA IDÉNTICA EN ESCRITORIO Y MÓVIL
//
//   escritorio : src/main/notesMerge.ts
//   móvil      : mobile/src/notesMerge.ts
//
// Los dos dispositivos tienen que resolver el mismo conflicto exactamente igual.
// Si la lógica diverge, el resultado de una sincronización vuelve a depender de
// quién escribió el último el fichero de Drive, que es justo el fallo que este
// módulo elimina. Son dos proyectos TypeScript independientes y no hay paquete
// npm compartido: CUALQUIER CAMBIO AQUÍ HAY QUE REPLICARLO LITERALMENTE EN EL
// OTRO FICHERO. No añadir dependencias de framework — debe poder copiarse tal cual.
//
// Reglas del merge:
//   1. Nota contra nota: gana la copia con `updatedAt` más reciente. En empate
//      gana la del primer argumento (por convención, la copia local).
//   2. Tombstone contra nota: si `deletedAt >= updatedAt`, la nota queda borrada
//      (el empate lo gana el borrado: borrar es siempre posterior a la edición
//      que dejó ese `updatedAt`).
//   3. Edición contra tombstone: si `updatedAt > deletedAt`, la edición revive
//      la nota y el tombstone se descarta.
//   4. Los tombstones caducan a los TOMBSTONE_TTL_DAYS días. Ya no se borran
//      tras subirlos —viven en Drive— así que sin caducidad crecerían sin fin.
// ─────────────────────────────────────────────────────────────────────────────

/** Nota vista por el merge: solo necesita `id` y `updatedAt`; el resto de campos
 *  viajan intactos (el merge nunca reconstruye una nota campo a campo). */
export interface MergeableNote {
  id: string
  updatedAt: string
  createdAt?: string
  [key: string]: unknown
}

/** Lápida de una nota borrada: sobrevive al borrado para que ningún dispositivo
 *  con una copia vieja pueda resucitarla. */
export interface Tombstone {
  id: string
  deletedAt: string
}

export interface NotesSnapshot {
  notes: MergeableNote[]
  deletedNoteIds: Tombstone[]
}

export const TOMBSTONE_TTL_DAYS = 90

const TOMBSTONE_TTL_MS = TOMBSTONE_TTL_DAYS * 24 * 60 * 60 * 1000
const EPOCH_ISO = '1970-01-01T00:00:00.000Z'

export function nowIso(): string {
  return new Date().toISOString()
}

function toMs(iso: unknown): number {
  if (typeof iso !== 'string' || !iso) return 0
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? 0 : ms
}

/** Garantiza que la nota tiene `updatedAt`. Las notas anteriores a este esquema
 *  heredan su `createdAt` (fecha real y pasada), así que cualquier edición o
 *  borrado posterior las gana. */
export function normalizeNote(raw: unknown): MergeableNote | null {
  if (!raw || typeof raw !== 'object') return null
  const note = raw as MergeableNote
  if (typeof note.id !== 'string' || !note.id) return null
  if (typeof note.updatedAt === 'string' && note.updatedAt) return note
  const fallback = typeof note.createdAt === 'string' && note.createdAt ? note.createdAt : EPOCH_ISO
  return { ...note, updatedAt: fallback }
}

function dedupeTombstones(tombstones: Tombstone[]): Tombstone[] {
  const byId = new Map<string, Tombstone>()
  for (const tombstone of tombstones) {
    const previous = byId.get(tombstone.id)
    if (!previous || toMs(tombstone.deletedAt) > toMs(previous.deletedAt)) byId.set(tombstone.id, tombstone)
  }
  return [...byId.values()]
}

/** Descarta los tombstones caducados (ver regla 4). */
export function pruneTombstones(tombstones: Tombstone[], referenceMs: number = Date.now()): Tombstone[] {
  const limit = referenceMs - TOMBSTONE_TTL_MS
  return tombstones.filter((tombstone) => toMs(tombstone.deletedAt) >= limit)
}

/** Acepta cualquier formato que haya podido quedar guardado —`Note[]` plano de
 *  las primeras versiones, `deletedNoteIds` como lista de strings, o el formato
 *  actual— y devuelve un snapshot normalizado. Los tombstones antiguos (solo id)
 *  se fechan en el momento de la migración: son borrados reales y recientes, y
 *  así ganan a las notas viejas, cuyo `updatedAt` heredado es anterior. */
export function normalizeSnapshot(raw: unknown): NotesSnapshot {
  const source = (Array.isArray(raw) ? { notes: raw } : raw ?? {}) as {
    notes?: unknown
    deletedNoteIds?: unknown
  }

  const notes: MergeableNote[] = []
  if (Array.isArray(source.notes)) {
    for (const item of source.notes) {
      const note = normalizeNote(item)
      if (note) notes.push(note)
    }
  }

  const migratedAt = nowIso()
  const tombstones: Tombstone[] = []
  if (Array.isArray(source.deletedNoteIds)) {
    for (const item of source.deletedNoteIds) {
      if (typeof item === 'string' && item) {
        tombstones.push({ id: item, deletedAt: migratedAt })
      } else if (item && typeof item === 'object') {
        const tombstone = item as Tombstone
        if (typeof tombstone.id !== 'string' || !tombstone.id) continue
        tombstones.push({
          id: tombstone.id,
          deletedAt: typeof tombstone.deletedAt === 'string' && tombstone.deletedAt ? tombstone.deletedAt : migratedAt
        })
      }
    }
  }

  return { notes, deletedNoteIds: dedupeTombstones(tombstones) }
}

/** Fusiona dos snapshots aplicando las reglas de la cabecera. `a` es, por
 *  convención en las dos apps, la copia local; `b` la remota. */
export function mergeNotes(a: NotesSnapshot, b: NotesSnapshot): NotesSnapshot {
  const tombstones = new Map<string, Tombstone>()
  for (const tombstone of [...a.deletedNoteIds, ...b.deletedNoteIds]) {
    const previous = tombstones.get(tombstone.id)
    if (!previous || toMs(tombstone.deletedAt) > toMs(previous.deletedAt)) tombstones.set(tombstone.id, tombstone)
  }

  // Regla 1. El Map conserva el orden de primera inserción, así que un empate de
  // `updatedAt` lo gana la copia de `a` y el orden de salida es determinista.
  const winners = new Map<string, MergeableNote>()
  for (const note of [...a.notes, ...b.notes]) {
    const previous = winners.get(note.id)
    if (!previous || toMs(note.updatedAt) > toMs(previous.updatedAt)) winners.set(note.id, note)
  }

  const notes: MergeableNote[] = []
  for (const note of winners.values()) {
    const tombstone = tombstones.get(note.id)
    if (tombstone && toMs(tombstone.deletedAt) >= toMs(note.updatedAt)) continue // regla 2
    if (tombstone) tombstones.delete(note.id) // regla 3: la edición revive la nota
    notes.push(note)
  }

  return { notes, deletedNoteIds: pruneTombstones([...tombstones.values()]) }
}
