import { useState, useEffect, useRef } from 'react'
import { App as CapApp } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { LocalNotifications } from '@capacitor/local-notifications'
import type { PluginListenerHandle } from '@capacitor/core'
import {
  initAuth, isAuthenticated, handleCallback, startAuth, logout,
  isNative, CAP_STATE_PREFIX, DEEP_LINK_SCHEME, NATIVE_REDIRECT_SCHEME,
  handleNativeCallback, proactiveRefresh, wasExchangeRetryable
} from './auth'
import {
  handleGoogleCalendarCallback, initGCalAuth,
  isGoogleCalendarAuthenticated, startGoogleCalendarAuth, adoptCombinedTokens,
  proactiveRefreshGCal, wasGCalExchangeRetryable
} from './googleCalendarAuth'
import {
  handleMicrosoftCallback, initMicrosoftAuth,
  proactiveRefreshMicrosoft, wasMsExchangeRetryable
} from './microsoftAuth'
import { readNotes, pushNotesToDrive, readQuickItems } from './drive'
import { mergeNotes, nowIso } from './notesMerge'
import type { MergeableNote, NotesSnapshot, Tombstone } from './notesMerge'
import {
  requestNotificationPermission, scheduleNotifications, createNotificationChannel
} from './notifications'
import type { Note, QuickItem } from './types'
import NoteList from './components/NoteList'

type AppState = 'loading' | 'login' | 'ready' | 'auth-error' | 'drive-error' | 'relay'

const AUTO_SYNC_INTERVAL = 2 * 60 * 1000 // 2 minutos

/** Construye el deep link que devuelve el código de OAuth a la app nativa. */
function buildDeepLink(code: string, state: string): string {
  return `${DEEP_LINK_SCHEME}://callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`
}

/** Espera antes de reintentar un intercambio de código por token que ha fallado
 *  por red. El móvil vuelve de Chrome Custom Tabs a menudo antes de recuperar
 *  cobertura estable; 1,5 s bastan para que la interfaz de red esté lista. */
const EXCHANGE_RETRY_BACKOFF_MS = 1500

/** Ejecuta un intercambio de código por token y lo reintenta UNA vez, tras un
 *  pequeño backoff, si el fallo pinta a problema de red o de servidor. Un error
 *  OAuth explícito (invalid_grant, invalid_request, código ya canjeado…) NO se
 *  reintenta: reintentarlo no arregla nada. Sin esto, un corte de red de un
 *  segundo al volver del navegador obligaba a repetir todo el login. */
/** `Note` y `MergeableNote` describen el mismo objeto, pero TypeScript no las da
 *  por compatibles porque `Note` es una interfaz (sin índice de campos libres).
 *  El puente se hace con un cast, en estos dos únicos sitios. */
function toSnapshot(notes: Note[], deletedNoteIds: Tombstone[]): NotesSnapshot {
  return { notes: notes as unknown as MergeableNote[], deletedNoteIds }
}

function notesOf(snapshot: NotesSnapshot): Note[] {
  return snapshot.notes as unknown as Note[]
}

async function exchangeWithRetry<T>(
  run: () => Promise<T>,
  succeeded: (r: T) => boolean,
  retryable: () => boolean
): Promise<T> {
  const first = await run()
  if (succeeded(first) || !retryable()) return first
  console.warn('[auth] intercambio fallido por red; reintentando en', EXCHANGE_RETRY_BACKOFF_MS, 'ms')
  await new Promise(resolve => setTimeout(resolve, EXCHANGE_RETRY_BACKOFF_MS))
  return run()
}

export default function App() {
  const [state, setState] = useState<AppState>('loading')
  const [deepLink, setDeepLink] = useState('')
  const [notes, setNotes] = useState<Note[]>([])
  const [tombstones, setTombstones] = useState<Tombstone[]>([])
  const [quickItems, setQuickItems] = useState<QuickItem[]>([])
  const [syncing, setSyncing] = useState(false)
  // Contador de peticiones de "nota nueva" llegadas por deep link (botón + del
  // widget de Android). Se pasa a NoteList, que abre el editor al verlo subir.
  // Es un contador y no un booleano para que dos pulsaciones seguidas cuenten.
  const [newNoteRequest, setNewNoteRequest] = useState(0)
  // Petición de "abrir esta nota" llegada por deep link (fila de nota del
  // widget de Android). `seq` sube en cada pulsación para que abrir dos veces
  // seguidas la misma nota vuelva a disparar el efecto de NoteList.
  const [openNoteRequest, setOpenNoteRequest] = useState<{ id: string; seq: number } | null>(null)
  const notesRef = useRef<Note[]>([])
  const tombstonesRef = useRef<Tombstone[]>([])
  // Evita procesar dos veces el mismo deep link (puede llegar a la vez por
  // getLaunchUrl() en arranque en frío y por el evento appUrlOpen).
  const handledUrls = useRef<Set<string>>(new Set())
  // `productividapp://new-note` es siempre la misma URL, así que no puede
  // deduplicarse por texto (bloquearía la segunda pulsación del widget). Se
  // deduplica solo la doble entrega del arranque en frío, por ventana de tiempo.
  const lastNewNoteAt = useRef(0)
  // Mismo problema con `productividapp://open-note?id=...`: se deduplica solo
  // la doble entrega del arranque en frío (misma nota, ventana de 1,5 s).
  const lastOpenNote = useRef<{ id: string; at: number }>({ id: '', at: 0 })

  // Mantener refs sincronizadas para usarlas en closures de timers/eventos
  useEffect(() => { notesRef.current = notes }, [notes])
  useEffect(() => { tombstonesRef.current = tombstones }, [tombstones])

  useEffect(() => {
    let listener: PluginListenerHandle | null = null
    let notifListener: PluginListenerHandle | null = null
    let cancelled = false

    /** Procesa `productividapp://callback?code=...&state=...` venga de donde venga.
     *  Devuelve qué login se completó, para que el arranque en frío sepa si el
     *  estado de la app ya quedó fijado ('drive') o si debe seguir su curso. */
    async function processDeepLink(rawUrl: string): Promise<'none' | 'drive' | 'calendar'> {
      let parsed: URL
      try { parsed = new URL(rawUrl) } catch { return 'none' }

      // --- Callback del login combinado nativo (Drive + Calendar) ---
      // `com.googleusercontent.apps.<id>:/oauth2redirect?code=...&state=...`
      // Chrome Custom Tabs navega DIRECTAMENTE a este esquema al terminar el
      // login: Android lo entrega a la app sin pasar por el relé de GitHub
      // Pages, así que no depende de que Chrome conserve la activación de
      // usuario ni de que se descargue y ejecute el bundle de la web.
      if (parsed.protocol === `${NATIVE_REDIRECT_SCHEME}:`) {
        // Se marca ANTES del intercambio para que la doble entrega del arranque
        // en frío (getLaunchUrl + appUrlOpen) no lo procese dos veces en
        // paralelo; si el intercambio acaba fallando se desmarca al final, para
        // que una reentrega posterior del mismo intent pueda volver a intentarlo.
        if (handledUrls.current.has(rawUrl)) return 'none'
        handledUrls.current.add(rawUrl)

        // Cerrar la Custom Tab de Chrome que quedó abierta detrás.
        try { await Browser.close() } catch { /* ya estaba cerrada */ }

        const code = parsed.searchParams.get('code')
        if (!code) {
          console.error('[auth] callback nativo sin code', parsed.searchParams.get('error'))
          handledUrls.current.delete(rawUrl)
          setState('auth-error')
          return 'drive'
        }

        const cbState = parsed.searchParams.get('state') ?? ''
        const tokens = await exchangeWithRetry(
          () => handleNativeCallback(code, cbState),
          t => !!t,
          wasExchangeRetryable
        )
        if (!tokens) {
          handledUrls.current.delete(rawUrl)
          setState('auth-error')
          return 'drive'
        }

        // El mismo token lleva los scopes de Drive y de Calendar: se copia al
        // almacén de Calendar para que quede conectado con este único login.
        // NO se encadena startGoogleCalendarAuth(): ya no hace falta.
        try { await adoptCombinedTokens(tokens) } catch (e) {
          console.error('[auth] no se pudo adoptar la sesión de Calendar', e)
        }
        window.dispatchEvent(new CustomEvent('auth-updated'))
        await loadNotes()
        return 'drive'
      }

      if (parsed.protocol !== `${DEEP_LINK_SCHEME}:`) return 'none'

      // `productividapp://new-note` — botón "+" del widget de Android.
      // No es un callback de OAuth: solo pide abrir el editor de nota nueva.
      if (parsed.hostname === 'new-note') {
        const now = Date.now()
        if (now - lastNewNoteAt.current < 1500) return 'none'
        lastNewNoteAt.current = now
        try { await Browser.close() } catch { /* no había Custom Tab abierta */ }
        setNewNoteRequest(n => n + 1)
        // 'none' para que el arranque siga su curso y cargue las notas: NoteList
        // atenderá la petición en cuanto se monte.
        return 'none'
      }

      // `productividapp://open-note?id=...` — fila de nota del widget: abrir
      // esa nota concreta en el editor.
      if (parsed.hostname === 'open-note') {
        const noteId = parsed.searchParams.get('id') ?? ''
        if (!noteId) return 'none'
        const now = Date.now()
        const last = lastOpenNote.current
        if (last.id === noteId && now - last.at < 1500) return 'none'
        lastOpenNote.current = { id: noteId, at: now }
        try { await Browser.close() } catch { /* no había Custom Tab abierta */ }
        setOpenNoteRequest(prev => ({ id: noteId, seq: (prev?.seq ?? 0) + 1 }))
        // 'none': el arranque sigue su curso y carga las notas; NoteList
        // atenderá la petición en cuanto se monte.
        return 'none'
      }

      // `productividapp://open` — fila de evento de calendario del widget:
      // solo abrir la app, sin navegación específica.
      if (parsed.hostname === 'open') {
        try { await Browser.close() } catch { /* no había Custom Tab abierta */ }
        return 'none'
      }

      if (handledUrls.current.has(rawUrl)) return 'none'
      handledUrls.current.add(rawUrl)

      const code = parsed.searchParams.get('code')
      const cbState = parsed.searchParams.get('state') ?? ''
      if (!code) return 'none'

      // Cerrar la Custom Tab de Chrome que quedó abierta detrás.
      try { await Browser.close() } catch { /* ya estaba cerrada */ }

      // Los handlers leen el código de window.location.search: se lo dejamos ahí
      // con el state sin el prefijo `cap.`, que solo sirve para el relé.
      if (cbState === 'cap.g_cal') {
        window.history.replaceState({}, '', `/?code=${encodeURIComponent(code)}&state=g_cal`)
        const ok = await exchangeWithRetry(
          handleGoogleCalendarCallback, r => r, wasGCalExchangeRetryable
        )
        window.history.replaceState({}, '', '/')
        if (!ok) handledUrls.current.delete(rawUrl)
        // Notificar a CalendarView que el estado de auth cambió. Sin esto, el
        // componente no se entera: visibilitychange puede haber disparado bump()
        // antes de que terminara el fetch de token exchange (race condition).
        window.dispatchEvent(new CustomEvent('auth-updated'))
        return 'calendar'
      }

      if (cbState === 'cap.ms') {
        window.history.replaceState({}, '', `/?code=${encodeURIComponent(code)}&state=ms`)
        const ok = await exchangeWithRetry(
          handleMicrosoftCallback, r => r, wasMsExchangeRetryable
        )
        window.history.replaceState({}, '', '/')
        if (!ok) handledUrls.current.delete(rawUrl)
        window.dispatchEvent(new CustomEvent('auth-updated'))
        return 'calendar'
      }

      // Login de Drive (sesión principal de la app).
      window.history.replaceState({}, '', `/?code=${encodeURIComponent(code)}&state=${encodeURIComponent(cbState)}`)
      const ok = await exchangeWithRetry(handleCallback, r => r, wasExchangeRetryable)
      window.history.replaceState({}, '', '/')

      if (ok) {
        await loadNotes()
        // Auto-conectar Google Calendar si aún no está vinculado.
        // Abre Chrome Custom Tabs de nuevo; el usuario acepta una vez y queda
        // conectado de forma persistente (tokens en SharedPreferences).
        if (!isGoogleCalendarAuthenticated()) {
          try { await startGoogleCalendarAuth() } catch { /* no bloquear el arranque */ }
        }
      } else {
        handledUrls.current.delete(rawUrl)
        setState('auth-error')
      }
      return 'drive'
    }

    async function boot(): Promise<void> {
      const query = new URLSearchParams(window.location.search)
      const queryCode = query.get('code')
      const queryState = query.get('state') ?? ''

      // 1) Modo relé: esta página se ha abierto en Chrome (GitHub Pages) como
      //    redirect_uri de un login lanzado DESDE la app nativa. Hay que
      //    devolverle el código a la app por deep link. Se distingue del login
      //    de la PWA web por el prefijo del state.
      if (!isNative() && queryCode && queryState.startsWith(CAP_STATE_PREFIX)) {
        const link = buildDeepLink(queryCode, queryState)
        setDeepLink(link)
        setState('relay')
        // Intento automático; si Chrome lo bloquea por falta de gesto del
        // usuario, la pantalla de relé ofrece un botón que sí lo tiene.
        window.location.href = link
        return
      }

      // 2) SIEMPRE cargar los tokens persistidos antes de comprobar la sesión.
      await initAuth()
      await Promise.all([initGCalAuth(), initMicrosoftAuth()])
      if (cancelled) return

      // Refresh proactivo: si un token está caducado o a punto de caducar,
      // refrescarlo AHORA antes de que la app lance sus API calls en paralelo.
      // Sin esto, readNotes() y readQuickItems() llaman getAccessToken() simultáneamente
      // con el token expirado → dos refreshes en paralelo → posible invalid_grant → logout.
      // Se hace también para Calendar y Microsoft, para que la primera pantalla
      // no dependa de un refresco en caliente. proactiveRefreshGCal() es un no-op
      // cuando la sesión de Calendar es la combinada de Drive (ya cubierta arriba).
      await Promise.all([
        proactiveRefresh(),
        proactiveRefreshGCal(),
        proactiveRefreshMicrosoft(),
      ])
      if (cancelled) return

      // Canal de notificaciones de Android para los avisos de vencimiento.
      // No-op en web; debe existir antes de programar ningún aviso.
      await createNotificationChannel()
      if (cancelled) return

      // El permiso se pide aquí, en el arranque, y NO dentro de loadNotes():
      // loadNotes() solo se alcanza con la sesión de Drive ya activa, así que
      // un usuario en la pantalla de login no veía nunca el diálogo del sistema.
      // Hay que esperar la promesa: si no se await-ea, el diálogo de Android 13+
      // no llega a mostrarse.
      if (isNative()) {
        try {
          await requestNotificationPermission()
        } catch (e) {
          console.error('[notif] fallo al pedir permiso en el arranque', e)
        }
        if (cancelled) return
      }

      // 3) Deep link del OAuth nativo (Chrome Custom Tabs -> productividapp://)
      if (isNative()) {
        listener = await CapApp.addListener('appUrlOpen', (event) => {
          void processDeepLink(event.url)
        })
        if (cancelled) { void listener.remove(); listener = null; return }

        // Pulsar la notificación de vencimiento abre esa nota en el editor,
        // reutilizando el mismo mecanismo que la fila de nota del widget.
        notifListener = await LocalNotifications.addListener(
          'localNotificationActionPerformed',
          (action) => {
            const noteId = action.notification.extra?.noteId as string | undefined
            if (!noteId) return
            setOpenNoteRequest(prev => ({ id: noteId, seq: (prev?.seq ?? 0) + 1 }))
          }
        )
        if (cancelled) { void notifListener.remove(); notifListener = null; return }

        // Arranque en frío: si Android mató el proceso mientras estábamos en la
        // Custom Tab, el intent llega como intent de lanzamiento y NO dispara
        // appUrlOpen. Hay que leerlo explícitamente. Se comprueba siempre (no
        // solo sin sesión) porque el login de calendario ocurre con la sesión de
        // Drive ya activa.
        const launch = await CapApp.getLaunchUrl()
        const launchUrl = launch?.url ?? ''
        if (launchUrl.startsWith(`${DEEP_LINK_SCHEME}:`) || launchUrl.startsWith(`${NATIVE_REDIRECT_SCHEME}:`)) {
          // Solo el login de Drive deja la app en su estado final; tras uno de
          // calendario hay que seguir hasta cargar las notas.
          if (await processDeepLink(launchUrl) === 'drive') return
        }
      }

      // 4) Callback OAuth clásico (PWA web, o calendarios)
      if (queryCode) {
        if (queryState === 'ms') {
          await exchangeWithRetry(handleMicrosoftCallback, r => r, wasMsExchangeRetryable)
          window.history.replaceState({}, '', window.location.pathname)
        } else if (queryState === 'g_cal') {
          await exchangeWithRetry(handleGoogleCalendarCallback, r => r, wasGCalExchangeRetryable)
          window.history.replaceState({}, '', window.location.pathname)
        } else {
          const ok = await exchangeWithRetry(handleCallback, r => r, wasExchangeRetryable)
          window.history.replaceState({}, '', window.location.pathname)
          if (!ok) { setState('auth-error'); return }
        }
      }

      // 5) Sesión
      if (!isAuthenticated()) { setState('login'); return }
      await loadNotes()
    }

    void boot()

    return () => {
      cancelled = true
      if (listener) void listener.remove()
      if (notifListener) void notifListener.remove()
    }
  }, [])

  // Auto-refresh: cada 2 min + al volver a la pestaña
  useEffect(() => {
    if (state !== 'ready') return
    const id = setInterval(() => loadNotes(), AUTO_SYNC_INTERVAL)
    const handleVisibility = (): void => { if (!document.hidden) loadNotes() }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', handleVisibility) }
  }, [state])

  async function loadNotes() {
    if (syncing) return
    setSyncing(true)
    try {
      const [data, qItems] = await Promise.all([readNotes(), readQuickItems()])
      if (data === null) { setState('drive-error'); return }
      // Fusionar en vez de reemplazar: lo que haya en memoria puede ser más
      // reciente que Drive (p.ej. una escritura que falló por red), y el merge
      // decide nota a nota por `updatedAt` en vez de dejar ganar a Drive siempre.
      const merged = mergeNotes(toSnapshot(notesRef.current, tombstonesRef.current), data)
      const mergedNotes = notesOf(merged)
      setNotes(mergedNotes)
      setTombstones(merged.deletedNoteIds)
      setQuickItems(qItems ?? [])
      setState('ready')
      // Se programa siempre, sin condicionarlo al permiso: el plugin ignora
      // los avisos sin permiso sin romper nada, y así basta con conceder el
      // permiso desde ajustes para que la siguiente sincronización los active.
      void scheduleNotifications(mergedNotes).catch(e => console.error('[notif] schedule', e))
    } catch (e) {
      console.error('[drive]', e)
      // Si el token murió de verdad, auth.logout() ya limpió la sesión: en ese
      // caso volvemos al login en vez de dejar una pantalla de error de Drive.
      setState(isAuthenticated() ? 'drive-error' : 'login')
    } finally {
      setSyncing(false)
    }
  }

  async function saveNotes(updated: Note[]) {
    const previous = notesRef.current
    const now = nowIso()

    // Las vistas siguen mandando el array completo, así que `updatedAt` se sella
    // aquí comparando con el estado anterior: una nota que no ha cambiado
    // conserva su marca y no gana conflictos que no le corresponden.
    const previousById = new Map(previous.map(note => [note.id, note]))
    const stamped = updated.map(note => {
      const before = previousById.get(note.id)
      if (before && JSON.stringify(before) === JSON.stringify(note)) return before
      return { ...note, updatedAt: now }
    })

    // Lápidas de lo que ha desaparecido, con la hora del borrado.
    const currentIds = new Set(stamped.map(note => note.id))
    const tombs: Tombstone[] = [
      ...tombstonesRef.current.filter(tombstone => !currentIds.has(tombstone.id)),
      ...previous.filter(note => !currentIds.has(note.id)).map(note => ({ id: note.id, deletedAt: now }))
    ]

    setNotes(stamped)
    setTombstones(tombs)
    void scheduleNotifications(stamped)

    // Escritura no ciega: lee Drive, fusiona y escribe si nadie se ha adelantado.
    const merged = await pushNotesToDrive(toSnapshot(stamped, tombs))
    if (!merged) return
    const mergedNotes = notesOf(merged)
    setNotes(mergedNotes)
    setTombstones(merged.deletedNoteIds)
    void scheduleNotifications(mergedNotes)
  }

  if (state === 'loading') return (
    <div className="screen-center">
      <div className="spinner" />
      <p className="hint">Cargando...</p>
    </div>
  )

  if (state === 'relay') return (
    <div className="screen-center" style={{ gap: 16 }}>
      <div className="spinner" />
      <p className="hint">Volviendo a ProductividApp...</p>
      <button className="btn-secondary" onClick={() => { window.location.href = deepLink }}>
        Abrir ProductividApp
      </button>
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
        <button className="btn-secondary" onClick={() => { void logout(); setState('login') }}>
          Intentar de nuevo
        </button>
      </div>
    )
  }

  if (state === 'drive-error') return (
    <div className="screen-center">
      <p style={{ color: '#f87171', marginBottom: 8 }}>Error al acceder a Google Drive</p>
      <p style={{ color: '#9ca3af', fontSize: 13, marginBottom: 16 }}>Comprueba que la app tiene permiso de Drive</p>
      <button className="btn-secondary" style={{ marginBottom: 8 }} onClick={() => { void loadNotes() }}>
        Reintentar
      </button>
      <button className="btn-secondary" onClick={() => { void logout(); setState('login') }}>
        Volver al inicio
      </button>
    </div>
  )

  return (
    <NoteList
      notes={notes}
      quickItems={quickItems}
      syncing={syncing}
      onSave={saveNotes}
      onSync={loadNotes}
      onLogout={() => { void logout(); setState('login') }}
      newNoteRequest={newNoteRequest}
      onNewNoteHandled={() => setNewNoteRequest(0)}
      openNoteRequest={openNoteRequest}
      onOpenNoteHandled={() => setOpenNoteRequest(null)}
    />
  )
}
