import { getAccessToken } from './auth'
import type { Note, QuickItem } from './types'

const FOLDER_NAME = 'ProductividApp'
const NOTES_FILE = 'notas.json'
const QUICK_FILE = 'quickpanel.json'

async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = await getAccessToken()
  if (!token) throw new Error('No auth token')
  return fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...init?.headers } })
}

async function findFolderId(): Promise<string | null> {
  const q = `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const res = await apiFetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`)
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

async function findFileId(folderId: string, fileName: string): Promise<string | null> {
  const q = `name='${fileName}' and '${folderId}' in parents and trashed=false`
  const res = await apiFetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`)
  if (!res.ok) return null
  const data = await res.json() as { files: { id: string }[] }
  return data.files[0]?.id ?? null
}

export async function readNotes(): Promise<Note[] | null> {
  const folderId = await getOrCreateFolder()
  if (!folderId) return null

  const fileId = await findFileId(folderId, NOTES_FILE)
  if (!fileId) return []

  const res = await apiFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`)
  if (!res.ok) return null
  return res.json() as Promise<Note[]>
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

export async function writeNotes(notes: Note[]): Promise<boolean> {
  const folderId = await getOrCreateFolder()
  if (!folderId) return false

  const fileId = await findFileId(folderId, NOTES_FILE)
  const content = JSON.stringify(notes, null, 2)
  const metadata = fileId ? { name: NOTES_FILE } : { name: NOTES_FILE, parents: [folderId] }

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
