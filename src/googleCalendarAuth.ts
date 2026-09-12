import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import { Browser } from '@capacitor/browser'
import { getAccessToken, getTokens } from './auth'

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string
const CLIENT_SECRET = import.meta.env.VITE_GOOGLE_CLIENT_SECRET as string
const REDIRECT_URI = 'https://cmahillo.github.io/productividapp-mobile/'
const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly'

// Cliente OAuth de tipo "Android" (cliente público, sin secreto). En nativo, el
// login de Drive pide de una vez los scopes de Drive y de Calendar y deja aquí
// una copia de los tokens vía adoptCombinedTokens(): así no hay un segundo
// login encadenado. Esos tokens llevan `client: 'android'` y hay que refrescarlos
// con este client_id y SIN client_secret.
const ANDROID_CLIENT_ID = '366785901148-8de34o9t4qe6m0evt0s89khk5cruahg7.apps.googleusercontent.com'

interface Tokens {
  access_token: string
  refresh_token: string
  expires_at: number
  /** Cliente OAuth emisor. Ausente = 'web'. Ver auth.ts. */
  client?: 'web' | 'android'
}

// Caché en memoria cargada al arrancar mediante initGCalAuth().
// Preferences (SharedPreferences en Android) sobrevive a que Android mate el
// proceso y recree el WebView; localStorage del WebView no siempre lo hace.
let _gcalTokens: Tokens | null = null

/** Clave del "opt-out" de la sesión combinada: cuando el usuario desconecta
 *  Google Calendar a mano y la sesión de Calendar es en realidad la de Drive
 *  (login nativo combinado), no hay tokens propios que borrar — el mismo grant
 *  sirve para las dos APIs. Se marca esta bandera para que Calendar quede
 *  desconectado sin tirar la sesión de Drive. */
const COMBINED_OPT_OUT_KEY = 'g_cal_combined_off'
let _combinedOptOut = false

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
 *  Debe llamarse una vez al arrancar, ANTES de cualquier isGoogleCalendarAuthenticated(). */
export async function initGCalAuth(): Promise<void> {
  try {
    const { value } = await Preferences.get({ key: 'g_cal_tokens' })
    _gcalTokens = value ? JSON.parse(value) as Tokens : null
  } catch {
    _gcalTokens = null
  }
  try {
    const { value } = await Preferences.get({ key: COMBINED_OPT_OUT_KEY })
    _combinedOptOut = value === '1'
  } catch {
    _combinedOptOut = false
  }
  // Migración: las versiones anteriores guardaban aquí una COPIA del mismo
  // refresh_token del login combinado. Si la sesión es la combinada, esa copia
  // sobra y es justo la que provocaba refrescos duplicados: se descarta.
  // Requiere que initAuth() ya haya corrido (App.tsx lo garantiza).
  if (_gcalTokens && usesCombinedDriveSession()) await clearGCalTokens()
}

/** True cuando la sesión de Google Calendar ES la sesión de Drive: el login
 *  nativo combinado pide en una sola autorización los scopes de Drive y de
 *  Calendar, así que hay UN único par de tokens.
 *
 *  En ese caso este módulo NO mantiene almacén ni ciclo de refresco propios:
 *  delega en auth.ts. Antes se guardaba una copia del mismo refresh_token en
 *  `g_cal_tokens`, con su propio `expires_at` y su propio single-flight; como
 *  ambas copias caducan a la vez, en la ventana de refresco se disparaban DOS
 *  POST de refresco concurrentes con el mismo refresh_token desde dos
 *  single-flights que no se conocían, y Google podía invalidar el sobrante. */
function usesCombinedDriveSession(): boolean {
  if (_combinedOptOut) return false
  const drive = getTokens()
  return !!drive?.refresh_token && drive.client === 'android'
}

async function setCombinedOptOut(value: boolean): Promise<void> {
  _combinedOptOut = value
  if (value) await Preferences.set({ key: COMBINED_OPT_OUT_KEY, value: '1' })
  else await Preferences.remove({ key: COMBINED_OPT_OUT_KEY })
}

export function getGCalTokens(): Tokens | null {
  return _gcalTokens
}

async function saveGCalTokens(t: Tokens): Promise<void> {
  _gcalTokens = t
  await Preferences.set({ key: 'g_cal_tokens', value: JSON.stringify(t) })
}

async function clearGCalTokens(): Promise<void> {
  _gcalTokens = null
  await Preferences.remove({ key: 'g_cal_tokens' })
}

export function isGoogleCalendarAuthenticated(): boolean {
  // En nativo, la sesión combinada de Drive YA lleva el scope de Calendar.
  if (usesCombinedDriveSession()) return true
  return !!_gcalTokens?.refresh_token
}

/** Adopta como sesión de Google Calendar los tokens del login combinado nativo
 *  de auth.ts (Drive + Calendar en una sola autorización).
 *
 *  NO se guarda una copia en `g_cal_tokens`: el par de tokens vive en un único
 *  sitio (auth.ts) y se refresca por un único single-flight. Aquí solo se
 *  descarta cualquier copia antigua y se levanta el opt-out, para que
 *  isGoogleCalendarAuthenticated() y getGoogleCalendarToken() pasen a delegar
 *  en la sesión de Drive.
 *
 *  El parámetro se mantiene por claridad en la llamada (y para no depender del
 *  orden en que se persiste la sesión de Drive), aunque no se almacene. */
export async function adoptCombinedTokens(_t: Tokens): Promise<void> {
  await clearGCalTokens()
  await setCombinedOptOut(false)
}

// Margen de refresco. Debe ser MENOR que el periodo del auto-sync (2 min) para
// que no coincidan: si ambos valen 5 min, cada ciclo de sync entra justo en la
// ventana de refresco y dispara refrescos en cascada.
const REFRESH_MARGIN_MS = 2 * 60 * 1000

// Single-flight: si varias llamadas concurrentes detectan el token caducado,
// todas comparten el MISMO POST de refresco. Sin esto, Google responde
// `invalid_grant` a los refrescos sobrantes y la sesión se borraba sola.
let gcalRefreshFlight: Promise<string | null> | null = null

export async function getGoogleCalendarToken(): Promise<string | null> {
  // Sesión combinada nativa: el token y su refresco los gestiona auth.ts en
  // exclusiva (un solo almacén, un solo single-flight). Ver usesCombinedDriveSession().
  if (usesCombinedDriveSession()) return getAccessToken()

  const t = getGCalTokens()
  if (!t) return null
  if (t.expires_at - Date.now() > REFRESH_MARGIN_MS) return t.access_token
  if (gcalRefreshFlight) return gcalRefreshFlight
  gcalRefreshFlight = refreshGCalToken(t)
    .finally(() => { gcalRefreshFlight = null })
  return gcalRefreshFlight
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

// Tolerancia a `invalid_grant` puntual. Un invalid_grant aislado no significa
// necesariamente que el refresh_token esté revocado: también lo devuelve Google
// cuando dos refrescos concurrentes usan el mismo token y uno llega tarde. Solo
// se borra la sesión tras 3 fallos CONSECUTIVOS (mismo criterio que la app de
// escritorio). Un refresco correcto resetea el contador.
const MAX_CONSECUTIVE_INVALID_GRANT = 3
let gcalInvalidGrantCount = 0

async function refreshGCalToken(token: Tokens): Promise<string | null> {
  let res: Response
  try {
    res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: refreshBody(token),
    })
  } catch (e) {
    // Fallo de red (móvil sin cobertura, DNS, etc.): la sesión sigue siendo
    // válida, no se toca. Se reintentará en la siguiente llamada.
    console.warn('[g-cal-auth] Refresco fallido por red, sesión preservada', e)
    return null
  }

  if (!res.ok) {
    let errorCode = ''
    try {
      const body = await res.json() as { error?: string }
      errorCode = body.error ?? ''
    } catch { /* respuesta no JSON */ }
    if (errorCode === 'invalid_grant') {
      gcalInvalidGrantCount++
      if (gcalInvalidGrantCount >= MAX_CONSECUTIVE_INVALID_GRANT) {
        console.warn('[g-cal-auth] invalid_grant x%d: se limpia la sesión de Google Calendar', gcalInvalidGrantCount)
        gcalInvalidGrantCount = 0
        await clearGCalTokens()
      } else {
        console.warn('[g-cal-auth] invalid_grant %d/%d, sesión preservada', gcalInvalidGrantCount, MAX_CONSECUTIVE_INVALID_GRANT)
      }
    } else {
      console.warn('[g-cal-auth] Refresco fallido, sesión preservada', res.status, errorCode)
    }
    return null
  }

  gcalInvalidGrantCount = 0
  const data = await res.json() as { access_token: string; expires_in: number }
  // Partimos del token que se usó para refrescar (no de getGCalTokens(), que
  // puede haber pasado a null por un logout concurrente) para conservar el
  // refresh_token y la marca `client`.
  const updated: Tokens = { ...token, access_token: data.access_token, expires_at: Date.now() + data.expires_in * 1000 }
  await saveGCalTokens(updated)
  return data.access_token
}

/** Refresca el token de Google Calendar en el arranque si está caducado o a
 *  punto de caducar, para que la primera carga de eventos no dependa de un
 *  refresco en caliente. En la sesión combinada nativa no hace nada: de eso ya
 *  se encarga proactiveRefresh() de auth.ts sobre el único par de tokens. */
export async function proactiveRefreshGCal(): Promise<void> {
  if (usesCombinedDriveSession()) return
  const t = getGCalTokens()
  if (!t?.refresh_token) return
  if (t.expires_at - Date.now() > REFRESH_MARGIN_MS) return
  await getGoogleCalendarToken()
}

const PKCE_KEY = 'g_cal_pkce_v'

/** Guarda el code_verifier donde sobreviva al salto al navegador externo.
 *  En nativo NO vale localStorage: Chrome Custom Tabs carga GitHub Pages con su
 *  propio origen y su propio localStorage, así que el verifier se perdería. */
async function savePkceVerifier(verifier: string): Promise<void> {
  if (Capacitor.isNativePlatform()) await Preferences.set({ key: PKCE_KEY, value: verifier })
  else localStorage.setItem(PKCE_KEY, verifier)
}

async function readPkceVerifier(): Promise<string | null> {
  if (Capacitor.isNativePlatform()) return (await Preferences.get({ key: PKCE_KEY })).value
  return localStorage.getItem(PKCE_KEY)
}

async function clearPkceVerifier(): Promise<void> {
  if (Capacitor.isNativePlatform()) await Preferences.remove({ key: PKCE_KEY })
  else localStorage.removeItem(PKCE_KEY)
}

export async function startGoogleCalendarAuth(): Promise<void> {
  // Si la sesión de Drive es la combinada nativa, ya tenemos autorización de
  // Calendar: "conectar" es simplemente levantar el opt-out, sin un segundo
  // login que pediría al usuario un consentimiento que ya dio.
  const drive = getTokens()
  if (_combinedOptOut && drive?.refresh_token && drive.client === 'android') {
    await setCombinedOptOut(false)
    window.dispatchEvent(new CustomEvent('auth-updated'))
    return
  }

  const { verifier, challenge } = await generatePKCE()
  await savePkceVerifier(verifier)
  // El prefijo `cap.` le dice al relé de GitHub Pages que devuelva el código a
  // la app por deep link (productividapp://) en vez de completar el login ahí.
  const stateValue = Capacitor.isNativePlatform() ? 'cap.g_cal' : 'g_cal'
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
    state: stateValue,
  })
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  if (Capacitor.isNativePlatform()) {
    // Chrome Custom Tabs: sin esto el deep link de vuelta no llega a la app.
    await Browser.open({ url: authUrl })
  } else {
    window.location.href = authUrl
  }
}

// True si el último intercambio de código por token falló por algo que pinta a
// problema de red o de servidor (y por tanto merece un reintento), en vez de por
// un error OAuth explícito. Lo consulta App.tsx. Ver auth.ts.
let _lastExchangeRetryable = false
export function wasGCalExchangeRetryable(): boolean { return _lastExchangeRetryable }

export async function handleGoogleCalendarCallback(): Promise<boolean> {
  _lastExchangeRetryable = false
  const code = new URLSearchParams(window.location.search).get('code')
  const verifier = await readPkceVerifier()
  if (!code || !verifier) return false

  let res: Response
  try {
    res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI, grant_type: 'authorization_code', code, code_verifier: verifier }),
    })
  } catch (e) {
    // Sin red al volver de Chrome Custom Tabs: reintentable, y NO se borra el
    // verifier — el reintento lo necesita.
    console.warn('[g-cal-auth] Token exchange sin red, reintentable', e)
    _lastExchangeRetryable = true
    return false
  }
  if (!res.ok) {
    const body = await res.text()
    // 5xx / 429 = fallo del servidor o rate-limit: reintentable. Un 400 con
    // invalid_grant/invalid_request es un fallo real y no se reintenta.
    _lastExchangeRetryable = res.status >= 500 || res.status === 429
    console.error('[g-cal-auth] Token exchange failed', res.status, body)
    if (!_lastExchangeRetryable) await clearPkceVerifier()
    return false
  }
  const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number }
  await saveGCalTokens({ access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + data.expires_in * 1000, client: 'web' })
  gcalInvalidGrantCount = 0
  await setCombinedOptOut(false)
  await clearPkceVerifier()
  window.history.replaceState({}, '', window.location.pathname)
  return true
}

export async function logoutGoogleCalendar(): Promise<void> {
  // Con la sesión combinada nativa no hay tokens propios que borrar (el grant es
  // el mismo que el de Drive): se marca el opt-out para desconectar Calendar sin
  // tirar la sesión de Drive.
  const drive = getTokens()
  if (drive?.refresh_token && drive.client === 'android') await setCombinedOptOut(true)
  await clearGCalTokens()
}
