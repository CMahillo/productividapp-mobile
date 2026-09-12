import { Preferences } from '@capacitor/preferences'
import { Browser } from '@capacitor/browser'
import { Capacitor } from '@capacitor/core'

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string
const CLIENT_SECRET = import.meta.env.VITE_GOOGLE_CLIENT_SECRET as string
const REDIRECT_URI = 'https://cmahillo.github.io/productividapp-mobile/'
const SCOPE = 'https://www.googleapis.com/auth/drive'

// ---------------------------------------------------------------------------
// Cliente OAuth de tipo "Android" — SOLO para la rama nativa (Capacitor).
// ---------------------------------------------------------------------------
// Los clientes OAuth de tipo Android son "clientes públicos": no tienen
// client_secret y Google NO lo acepta en el endpoint de token
// (https://developers.google.com/identity/protocols/oauth2/native-app —
// "The client_secret is not applicable to requests from clients registered as
// Android, iOS, or Chrome applications"). Por eso el client_id puede ir
// hardcodeado aquí: es un identificador público, igual que MS_CLIENT_ID.
//
// Ventajas frente al cliente Web + relé de GitHub Pages que usa la PWA:
//   1. No hay secreto que publicar en el bundle JS.
//   2. El redirect_uri es un esquema propio que Android entrega DIRECTAMENTE a
//      la app: Chrome no tiene que ejecutar JS en una página intermedia, así
//      que no depende de la "transient user activation" (~5 s) de Chrome.
//   3. Se pueden pedir los scopes de Drive y de Calendar en una sola pantalla
//      de consentimiento, en vez de encadenar dos logins.
const ANDROID_CLIENT_ID = '366785901148-8de34o9t4qe6m0evt0s89khk5cruahg7.apps.googleusercontent.com'

/** Esquema del redirect_uri nativo: el "client ID invertido" (reverse DNS del
 *  client ID, sin el sufijo `.apps.googleusercontent.com`). Debe estar
 *  declarado en AndroidManifest.xml como `<data android:scheme="..." />`. */
export const NATIVE_REDIRECT_SCHEME = 'com.googleusercontent.apps.366785901148-8de34o9t4qe6m0evt0s89khk5cruahg7'

/** redirect_uri completo del flujo nativo. El path lleva UNA sola barra
 *  (`scheme:/path`, no `scheme://path`), tal y como exige la documentación de
 *  Google para el método "Custom URI scheme". */
const ANDROID_REDIRECT_URI = `${NATIVE_REDIRECT_SCHEME}:/oauth2redirect`

/** Scopes del login combinado nativo: Drive (notas) + Calendar (agenda) en una
 *  única autorización. Un access_token de Google puede llevar varios scopes, así
 *  que el mismo par de tokens sirve para las dos APIs y sobra el segundo login. */
const NATIVE_SCOPE = 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/calendar.readonly'

/** Prefijo del parámetro `state` que marca un login iniciado desde la app nativa.
 *  La página de GitHub Pages lo usa para decidir si reenvía el código a la app
 *  (deep link `productividapp://`) o si completa el login como PWA web.
 *  Ya no lo usa el login de Drive nativo (ahora va por esquema propio), pero sí
 *  siguen usándolo los flujos de Google Calendar y Microsoft. */
export const CAP_STATE_PREFIX = 'cap.'

/** Esquema del deep link registrado en AndroidManifest.xml */
export const DEEP_LINK_SCHEME = 'productividapp'

export interface Tokens {
  access_token: string
  refresh_token: string
  expires_at: number
  /** Cliente OAuth que emitió estos tokens. Determina con qué client_id — y con
   *  o sin client_secret — hay que refrescarlos: un refresh_token emitido al
   *  cliente Android da `invalid_client` si se refresca con el cliente Web.
   *  Ausente = 'web' (tokens guardados antes de que existiera el cliente Android). */
  client?: 'web' | 'android'
}

/** True cuando corremos dentro del contenedor nativo (Android), no en un navegador.
 *  Se detecta en runtime: no depende de que VITE_IS_CAPACITOR se haya definido en
 *  el build, que es una fuente de fallos silenciosos. */
export function isNative(): boolean {
  return Capacitor.isNativePlatform()
}

// Caché en memoria cargada al arrancar mediante initAuth().
// Preferences (SharedPreferences en Android) sobrevive a que Android mate el
// proceso y recree el WebView; localStorage del WebView no siempre lo hace.
let _tokens: Tokens | null = null

function base64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const arr = crypto.getRandomValues(new Uint8Array(32))
  const verifier = base64url(arr.buffer)
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: base64url(hash) }
}

/** Carga los tokens del almacenamiento persistente a la caché en memoria.
 *  Debe llamarse una vez al arrancar, ANTES de cualquier isAuthenticated(). */
export async function initAuth(): Promise<void> {
  try {
    const { value } = await Preferences.get({ key: 'g_tokens' })
    _tokens = value ? JSON.parse(value) as Tokens : null
  } catch {
    _tokens = null
  }
}

export function getTokens(): Tokens | null {
  return _tokens
}

async function saveTokens(t: Tokens): Promise<void> {
  _tokens = t
  await Preferences.set({ key: 'g_tokens', value: JSON.stringify(t) })
}

export function isAuthenticated(): boolean {
  return !!_tokens?.refresh_token
}

// Margen de refresco. Debe ser MENOR que el periodo del auto-sync (2 min) para
// que no coincidan: si ambos valen 5 min, cada ciclo de sync entra justo en la
// ventana de refresco y dispara refrescos en cascada.
const REFRESH_MARGIN_MS = 2 * 60 * 1000

// Single-flight: si varias llamadas concurrentes detectan el token caducado
// (p.ej. Promise.all([readNotes(), readQuickItems()])), todas comparten el MISMO
// POST de refresco. Sin esto, la segunda request usa el mismo refresh_token que
// ya usó la primera; si Google rota el refresh_token, la segunda recibe
// invalid_grant → logout() borra _tokens → login inesperado.
let driveRefreshFlight: Promise<string | null> | null = null

export async function getAccessToken(): Promise<string | null> {
  const t = getTokens()
  if (!t) return null
  if (t.expires_at - Date.now() > REFRESH_MARGIN_MS) return t.access_token
  if (driveRefreshFlight) return driveRefreshFlight
  driveRefreshFlight = refreshAccessToken(t)
    .finally(() => { driveRefreshFlight = null })
  return driveRefreshFlight
}

/** Cuerpo del POST de refresco. El cliente Android es un cliente público: no
 *  lleva client_secret (Google lo rechaza para clientes Android/iOS/Chrome). */
function refreshBody(t: Tokens): URLSearchParams {
  const body = new URLSearchParams({
    client_id: t.client === 'android' ? ANDROID_CLIENT_ID : CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: t.refresh_token,
  })
  if (t.client !== 'android') body.set('client_secret', CLIENT_SECRET)
  return body
}

/** Refresca el token de Drive proactivamente si está caducado o próximo a caducar.
 *  Llamar en el arranque de la app, tras initAuth(), para evitar que el primer
 *  API call de loadNotes() tenga que esperar el refresh en caliente. */
export async function proactiveRefresh(): Promise<void> {
  const t = getTokens()
  if (!t?.refresh_token) return
  if (t.expires_at - Date.now() > REFRESH_MARGIN_MS) return
  await getAccessToken()
}

// Tolerancia a `invalid_grant` puntual. Google devuelve invalid_grant no solo
// cuando el refresh_token está revocado, sino también cuando dos refrescos
// concurrentes usan el mismo token y uno llega tarde. Cerrar sesión al primero
// obligaba a reconectar la cuenta cada pocos usos. Solo se borra tras 3 fallos
// CONSECUTIVOS (mismo criterio que la app de escritorio); un refresco correcto
// resetea el contador.
const MAX_CONSECUTIVE_INVALID_GRANT = 3
let driveInvalidGrantCount = 0

async function refreshAccessToken(token: Tokens): Promise<string | null> {
  let res: Response
  try {
    res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: refreshBody(token)
    })
  } catch (e) {
    // Sin red: NO invalidar la sesión, solo fallar esta operación.
    console.error('[auth] refresh: fallo de red', e)
    return null
  }

  if (!res.ok) {
    const body = await res.text()
    // Solo cerramos sesión si Google dice explícitamente que el refresh_token ya
    // no sirve (revocado / caducado). Un 5xx o un rate-limit NO debe borrar la
    // sesión: eso obligaba a reconectar la cuenta ante cualquier fallo pasajero.
    const revoked = res.status === 400 && body.includes('invalid_grant')
    if (revoked) {
      driveInvalidGrantCount++
      if (driveInvalidGrantCount >= MAX_CONSECUTIVE_INVALID_GRANT) {
        console.error('[auth] refresh fallido: invalid_grant x%d, se cierra sesión', driveInvalidGrantCount)
        driveInvalidGrantCount = 0
        await logout()
      } else {
        console.warn('[auth] refresh fallido: invalid_grant %d/%d, sesión preservada', driveInvalidGrantCount, MAX_CONSECUTIVE_INVALID_GRANT)
      }
    } else {
      console.error('[auth] refresh fallido', { status: res.status, revoked })
    }
    return null
  }

  driveInvalidGrantCount = 0
  const data = await res.json() as { access_token: string; expires_in: number }
  // Partimos del token que se usó para refrescar (no de getTokens(), que puede
  // haber pasado a null por un logout() concurrente) para conservar el
  // refresh_token y, sobre todo, la marca `client`.
  const updated: Tokens = { ...token, access_token: data.access_token, expires_at: Date.now() + data.expires_in * 1000 }
  await saveTokens(updated)
  return data.access_token
}

const PKCE_KEY = 'pkce_v'
const STATE_KEY = 'pkce_state'

/** Guarda el code_verifier donde sobreviva al salto al navegador externo.
 *  En nativo NO vale localStorage: Chrome Custom Tabs carga otra página con su
 *  propio origen y su propio localStorage, y además Android puede matar el
 *  proceso mientras el usuario está en Chrome. Preferences (SharedPreferences)
 *  sí sobrevive. Mismo patrón que googleCalendarAuth.ts y microsoftAuth.ts. */
async function savePkce(verifier: string, state: string): Promise<void> {
  if (isNative()) {
    await Preferences.set({ key: PKCE_KEY, value: verifier })
    await Preferences.set({ key: STATE_KEY, value: state })
  } else {
    localStorage.setItem(PKCE_KEY, verifier)
    localStorage.setItem(STATE_KEY, state)
  }
}

async function readPkce(): Promise<{ verifier: string | null; state: string | null }> {
  if (isNative()) {
    return {
      verifier: (await Preferences.get({ key: PKCE_KEY })).value,
      state: (await Preferences.get({ key: STATE_KEY })).value,
    }
  }
  return { verifier: localStorage.getItem(PKCE_KEY), state: localStorage.getItem(STATE_KEY) }
}

async function clearPkce(): Promise<void> {
  if (isNative()) {
    await Preferences.remove({ key: PKCE_KEY })
    await Preferences.remove({ key: STATE_KEY })
  } else {
    localStorage.removeItem(PKCE_KEY)
    localStorage.removeItem(STATE_KEY)
  }
}

export async function startAuth(): Promise<void> {
  const { verifier, challenge } = await generatePKCE()

  if (isNative()) {
    // --- Rama nativa (Android): cliente Android + esquema propio + PKCE real ---
    // El `state` es un nonce opaco y aleatorio, NO el code_verifier: meter el
    // verifier en el state (como hacía el flujo antiguo) lo expone en la URL y
    // anula la protección de PKCE. El verifier va a Preferences.
    const state = base64url(crypto.getRandomValues(new Uint8Array(16)).buffer)
    await savePkce(verifier, state)

    const params = new URLSearchParams({
      client_id: ANDROID_CLIENT_ID,
      redirect_uri: ANDROID_REDIRECT_URI,
      response_type: 'code',
      scope: NATIVE_SCOPE,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent',
      state,
    })
    // Google bloquea OAuth en WebViews embebidos (error 400 disallowed_useragent):
    // hay que salir a Chrome Custom Tabs.
    await Browser.open({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` })
    return
  }

  // --- Rama web (PWA en navegador): sin cambios respecto al flujo anterior ---
  // Un navegador normal no puede recibir un redirect a un esquema propio, así
  // que sigue usando el cliente Web + secreto + redirect a GitHub Pages.
  localStorage.setItem(PKCE_KEY, verifier)
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
    state: verifier,
  })
  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

/** Completa el login combinado nativo (Drive + Calendar) a partir del código que
 *  Chrome ha entregado a la app por el esquema propio.
 *
 *  El intercambio va SIN client_secret: el cliente Android es un cliente público
 *  y Google rechaza el secreto para este tipo de cliente. */
// True si el último intercambio de código por token falló por algo que pinta a
// problema de red o de servidor (móvil que vuelve de Chrome Custom Tabs sin
// cobertura estable, 5xx, rate-limit) y por tanto merece un reintento. False si
// el servidor devolvió un error OAuth explícito (invalid_grant, invalid_request,
// código ya canjeado…): eso es un fallo real y reintentarlo no arregla nada.
// Cuando es reintentable NO se borra el code_verifier: el reintento lo necesita.
let _lastExchangeRetryable = false
export function wasExchangeRetryable(): boolean { return _lastExchangeRetryable }

/** ¿Merece la pena reintentar este intercambio? Solo ante fallos del servidor o
 *  de transporte, nunca ante un error OAuth explícito del propio endpoint. */
function isRetryableExchangeStatus(status: number): boolean {
  return status >= 500 || status === 429 || status === 408
}

export async function handleNativeCallback(code: string, state: string): Promise<Tokens | null> {
  _lastExchangeRetryable = false
  const { verifier, state: expectedState } = await readPkce()

  if (!verifier) {
    const debug = { step: 'native_check', had_code: !!code, had_verifier: false }
    console.error('[auth] callback nativo sin code_verifier', debug)
    localStorage.setItem('auth_last_error', JSON.stringify(debug))
    return null
  }
  // Protección CSRF: el state debe ser exactamente el nonce que generamos.
  if (!expectedState || state !== expectedState) {
    const debug = { step: 'native_state_mismatch', had_expected: !!expectedState }
    console.error('[auth] state del callback nativo no coincide', debug)
    localStorage.setItem('auth_last_error', JSON.stringify(debug))
    await clearPkce()
    return null
  }

  let res: Response
  try {
    res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: ANDROID_CLIENT_ID,
        redirect_uri: ANDROID_REDIRECT_URI,
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
      }),
    })
  } catch (e) {
    // El móvil suele volver de Chrome Custom Tabs antes de recuperar cobertura
    // estable: esto es reintentable y NO se borra el verifier.
    const debug = { step: 'native_token_exchange_network', error: String(e) }
    console.warn('[auth] Intercambio de token nativo sin red, reintentable', debug)
    localStorage.setItem('auth_last_error', JSON.stringify(debug))
    _lastExchangeRetryable = true
    return null
  }
  if (!res.ok) {
    const body = await res.text()
    _lastExchangeRetryable = isRetryableExchangeStatus(res.status)
    const debug = { step: 'native_token_exchange', status: res.status, body: body.slice(0, 500), retryable: _lastExchangeRetryable }
    console.error('[auth] Intercambio de token nativo fallido', debug)
    localStorage.setItem('auth_last_error', JSON.stringify(debug))
    if (!_lastExchangeRetryable) await clearPkce()
    return null
  }

  const data = await res.json() as { access_token: string; refresh_token?: string; expires_in: number }
  // Google solo devuelve refresh_token en el primer consentimiento; si faltara,
  // conservamos el que ya teníamos en lugar de guardar una sesión inservible.
  const refresh = data.refresh_token ?? getTokens()?.refresh_token
  if (!refresh) {
    const debug = { step: 'native_no_refresh_token', keys: Object.keys(data) }
    console.error('[auth] Google no devolvió refresh_token', debug)
    localStorage.setItem('auth_last_error', JSON.stringify(debug))
    await clearPkce()
    return null
  }

  const tokens: Tokens = {
    access_token: data.access_token,
    refresh_token: refresh,
    expires_at: Date.now() + data.expires_in * 1000,
    client: 'android',
  }
  await saveTokens(tokens)
  driveInvalidGrantCount = 0
  await clearPkce()
  localStorage.removeItem('auth_last_error')
  return tokens
}

/** Recupera el code_verifier: primero de localStorage y, si no está, del propio
 *  parámetro `state` (la rama WEB de startAuth lo mete ahí para sobrevivir a que
 *  el navegador pierda el contexto de localStorage entre navegaciones).
 *  La rama nativa ya NO pasa por aquí: usa handleNativeCallback(), con el
 *  verifier en Preferences y un state que es un nonce opaco. */
function recoverVerifier(state: string | null): string | null {
  const stored = localStorage.getItem(PKCE_KEY)
  if (stored) return stored
  if (!state) return null
  const raw = state.startsWith(CAP_STATE_PREFIX) ? state.slice(CAP_STATE_PREFIX.length) : state
  return raw.length > 0 ? raw : null
}

export async function handleCallback(): Promise<boolean> {
  _lastExchangeRetryable = false
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const state = params.get('state')
  const verifier = recoverVerifier(state)

  if (!code || !verifier) {
    const debug = { step: 'check', had_code: !!code, had_verifier: !!verifier, had_state: !!state }
    console.error('[auth] Falta code o verifier', debug)
    localStorage.setItem('auth_last_error', JSON.stringify(debug))
    return false
  }

  let res: Response
  try {
    res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI, grant_type: 'authorization_code', code, code_verifier: verifier })
    })
  } catch (e) {
    const debug = { step: 'token_exchange_network', error: String(e) }
    console.warn('[auth] Intercambio de token sin red, reintentable', debug)
    localStorage.setItem('auth_last_error', JSON.stringify(debug))
    _lastExchangeRetryable = true
    return false
  }
  if (!res.ok) {
    const body = await res.text()
    _lastExchangeRetryable = isRetryableExchangeStatus(res.status)
    const debug = { step: 'token_exchange', status: res.status, body, redirect_uri: REDIRECT_URI, had_verifier: !!verifier, retryable: _lastExchangeRetryable }
    console.error('[auth] Intercambio de token fallido', debug)
    localStorage.setItem('auth_last_error', JSON.stringify(debug))
    return false
  }

  const data = await res.json() as { access_token: string; refresh_token?: string; expires_in: number }
  // Google solo devuelve refresh_token en el primer consentimiento; si faltara,
  // conservamos el que ya teníamos en lugar de guardar una sesión inservible.
  const refresh = data.refresh_token ?? getTokens()?.refresh_token
  if (!refresh) {
    const debug = { step: 'no_refresh_token', keys: Object.keys(data) }
    console.error('[auth] Google no devolvió refresh_token', debug)
    localStorage.setItem('auth_last_error', JSON.stringify(debug))
    return false
  }

  await saveTokens({ access_token: data.access_token, refresh_token: refresh, expires_at: Date.now() + data.expires_in * 1000, client: 'web' })
  driveInvalidGrantCount = 0
  localStorage.removeItem(PKCE_KEY)
  localStorage.removeItem('auth_last_error')
  return true
}

export async function logout(): Promise<void> {
  _tokens = null
  await Preferences.remove({ key: 'g_tokens' })
}
