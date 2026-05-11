import { useState, useEffect } from 'react'
import { isAuthenticated, handleCallback, startAuth, logout } from './auth'
import { readNotes, writeNotes } from './drive'
import { requestNotificationPermission, scheduleNotifications } from './notifications'
import type { Note } from './types'
import NoteList from './components/NoteList'

type AppState = 'loading' | 'login' | 'ready' | 'auth-error' | 'drive-error'

export default function App() {
  const [state, setState] = useState<AppState>('loading')
  const [notes, setNotes] = useState<Note[]>([])
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    async function init() {
      if (window.location.search.includes('code=')) {
        const ok = await handleCallback()
        if (!ok) { setState('auth-error'); return }
      }
      if (!isAuthenticated()) { setState('login'); return }
      await loadNotes()
    }
    init()
  }, [])

  async function loadNotes() {
    setSyncing(true)
    try {
      const data = await readNotes()
      if (data === null) { setState('drive-error'); return }
      setNotes(data)
      setState('ready')
      requestNotificationPermission().then(ok => { if (ok) scheduleNotifications(data) })
    } catch (e) {
      console.error('[drive]', e)
      setState('drive-error')
    } finally {
      setSyncing(false)
    }
  }

  async function saveNotes(updated: Note[]) {
    setNotes(updated)
    scheduleNotifications(updated)
    await writeNotes(updated)
  }

  if (state === 'loading') return (
    <div className="screen-center">
      <div className="spinner" />
      <p className="hint">Cargando...</p>
    </div>
  )

  if (state === 'login') return (
    <div className="screen-center">
      <div className="login-card">
        <div className="login-icon">📌</div>
        <h1>ProductividApp</h1>
        <p>Accede a tus notas del escritorio desde el móvil</p>
        <button className="btn-google" onClick={startAuth}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
            <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
            <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
          </svg>
          Iniciar sesión con Google
        </button>
      </div>
    </div>
  )

  if (state === 'auth-error') {
    const debug = localStorage.getItem('auth_last_error') ?? 'sin detalle'
    return (
      <div className="screen-center" style={{ gap: 12 }}>
        <p style={{ color: '#f87171' }}>Error de autenticación</p>
        <pre style={{ color: '#9ca3af', fontSize: 11, background: '#1f2937', padding: 12, borderRadius: 8, maxWidth: '90vw', whiteSpace: 'pre-wrap', wordBreak: 'break-all', textAlign: 'left' }}>{debug}</pre>
        <button className="btn-secondary" onClick={() => { logout(); setState('login') }}>
          Intentar de nuevo
        </button>
      </div>
    )
  }

  if (state === 'drive-error') return (
    <div className="screen-center">
      <p style={{ color: '#f87171', marginBottom: 8 }}>Error al acceder a Google Drive</p>
      <p style={{ color: '#9ca3af', fontSize: 13, marginBottom: 16 }}>Comprueba que la app tiene permiso de Drive</p>
      <button className="btn-secondary" onClick={() => { logout(); setState('login') }}>
        Volver al inicio
      </button>
    </div>
  )

  return (
    <NoteList
      notes={notes}
      syncing={syncing}
      onSave={saveNotes}
      onSync={loadNotes}
      onLogout={() => { logout(); setState('login') }}
    />
  )
}
