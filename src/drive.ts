import { getAccessToken } from './auth'
import { mergeNotes, normalizeSnapshot } from './notesMerge'
import type { NotesSnapshot } from './notesMerge'
import type { QuickItem } from './types'

const FOLDER_NAME = 'ProductividApp'
const NOTES_FILE = 'notas.json'
const LONG_NOTES_FILE = 'notas-largas.json'
const QUICK_FILE = 'quickpanel.json'

async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = await getAccessToken()
  if (!token) throw new Error('No auth token')
  return fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...init?.headers } })
}

async function findFolderId(): Promise<string | null> {
  const q = `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const res = await apiFetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&orderBy=createdTime`)
  if (!res.ok) return null
  const data = await res.json() as { files: { id: string }[] }
  return data.files[0]?.id ?? null
}

async function createFolder(): Promise<string | null> {
  const res = await apiFetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
  })
  if (!res.ok) return null
  const data = await res.json() as { id: string }
  return data.id
}

async function getOrCreateFolder(): Promise<string | null> {
  return (await findFolderId()) ?? createFolder()
}

async function findFile(
  folderId: string,
  fileName: string
): Promise<{ id: string; headRevisionId: string | null } | null> {
  const q = `name='${fileName}' and '${folderId}' in parents and trashed=false`
  const res = await apiFetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,headRevisionId)`)
  if (!res.ok) return null
  const data = await res.json() as { files: { id: string; headRevisionId?: string }[] }
  const file = data.files[0]
  return file ? { id: file.id, headRevisionId: file.headRevisionId ?? null } : null
}

async function findFileId(folderId: string, fileName: string): Promise<string | null> {
  return (await findFile(folderId, fileName))?.id ?? null
}

/** Revisión actual del fichero — el "número de versión" que usamos como
 *  condición de escritura (ver `pushNotesToDrive`). */
async function getHeadRevisionId(fileId: string): Promise<string | null> {
  const res = await apiFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=headRevisionId`)
  if (!res.ok) return null
  const data = await res.json() as { headRevisionId?: string }
  return data.headRevisionId ?? null
}

type RemoteNotes = { fileId: string | null; revisionId: string | null; snapshot: NotesSnapshot }

/** Genérico sobre el nombre de fichero: notas normales (`notas.json`) y notas
 *  largas del repositorio (`notas-largas.json`) comparten exactamente el mismo
 *  ciclo leer→fusionar→escribir condicionado, solo cambia el fichero. */
async function readRemoteFile(folderId: string, fileName: string): Promise<RemoteNotes | null> {
  const file = await findFile(folderId, fileName)
  if (!file) return { fileId: null, revisionId: null, snapshot: { notes: [], deletedNoteIds: [] } }

  const res = await apiFetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`)
  if (!res.ok) return null
  return {
    fileId: file.id,
    revisionId: file.headRevisionId,
    snapshot: normalizeSnapshot(await res.json())
  }
}

export async function readNotes(): Promise<NotesSnapshot | null> {
  const folderId = await getOrCreateFolder()
  if (!folderId) return null
  return (await readRemoteFile(folderId, NOTES_FILE))?.snapshot ?? null
}

/** Notas largas del repositorio (§5 PROPUESTA-EVOLUCION.md): fichero de Drive
 *  separado y aislado de `notas.json`, mismo algoritmo de lectura. */
export async function readLongNotes(): Promise<NotesSnapshot | null> {
  const folderId = await getOrCreateFolder()
  if (!folderId) return null
  return (await readRemoteFile(folderId, LONG_NOTES_FILE))?.snapshot ?? null
}

export async function readQuickItems(): Promise<QuickItem[] | null> {
  const folderId = await getOrCreateFolder()
  if (!folderId) return null

  const fileId = await findFileId(folderId, QUICK_FILE)
  if (!fileId) return []

  const res = await apiFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`)
  if (!res.ok) return null
  return res.json() as Promise<QuickItem[]>
}

async function uploadFile(folderId: string, fileId: string | null, fileName: string, content: string): Promise<boolean> {
  const metadata = fileId ? { name: fileName } : { name: fileName, parents: [folderId] }

  const boundary = 'pb_boundary_314159'
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: application/json',
    '',
    content,
    `--${boundary}--`
  ].join('\r\n')

  const url = fileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`

  const res = await apiFetch(url, {
    method: fileId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary="${boundary}"` },
    body
  })
  return res.ok
}

/** Intentos del ciclo leer → fusionar → escribir antes de rendirse. */
const SAVE_MAX_ATTEMPTS = 4

/** Único camino de escritura a Drive de una colección tipo notas: lee el
 *  estado remoto, lo fusiona con el local (merge compartido con el escritorio,
 *  ver notesMerge.ts) y escribe el resultado solo si el fichero remoto no ha
 *  cambiado desde la lectura. Nunca sobrescribe a ciegas. Devuelve el snapshot
 *  fusionado —el estado bueno— o `null` si no se pudo escribir. Usado tanto
 *  por `notas.json` como por `notas-largas.json` — mismo algoritmo, distinto
 *  fichero. */
async function pushSnapshotToDrive(fileName: string, local: NotesSnapshot): Promise<NotesSnapshot | null> {
  const folderId = await getOrCreateFolder()
  if (!folderId) return null

  for (let attempt = 1; attempt <= SAVE_MAX_ATTEMPTS; attempt++) {
    const remote = await readRemoteFile(folderId, fileName)
    if (!remote) return null

    const merged = mergeNotes(local, remote.snapshot)
    const content = JSON.stringify({ notes: merged.notes, deletedNoteIds: merged.deletedNoteIds }, null, 2)

    // La API v3 de Drive no expone ETags de fichero ni admite `If-Match` en la
    // subida, así que la condición se hace con `headRevisionId`: si cambió, otro
    // dispositivo escribió después de nuestra lectura y hay que rehacer el ciclo.
    const stillOurs = remote.fileId
      ? !remote.revisionId || (await getHeadRevisionId(remote.fileId)) === remote.revisionId
      : !(await findFileId(folderId, fileName))

    if (stillOurs) {
      if (!(await uploadFile(folderId, remote.fileId, fileName, content))) return null
      return merged
    }

    console.warn(`[drive] conflicto de versión en ${fileName}; reintento ${attempt}/${SAVE_MAX_ATTEMPTS}`)
    await new Promise(resolve => setTimeout(resolve, 300 * attempt))
  }

  return null
}

export async function pushNotesToDrive(local: NotesSnapshot): Promise<NotesSnapshot | null> {
  return pushSnapshotToDrive(NOTES_FILE, local)
}

/** Notas largas del repositorio (§5 PROPUESTA-EVOLUCION.md): fichero de Drive
 *  separado y aislado de `notas.json`, mismo algoritmo de sync. */
export async function pushLongNotesToDrive(local: NotesSnapshot): Promise<NotesSnapshot | null> {
  return pushSnapshotToDrive(LONG_NOTES_FILE, local)
}
