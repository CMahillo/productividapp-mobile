import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import { Browser } from '@capacitor/browser'

// Azure App Registration shared with the desktop app.
// Prerequisite: add https://cmahillo.github.io/productividapp-mobile/ as a
// Single-page application redirect URI in the Azure portal under this client ID.
const MS_CLIENT_ID = 'ed31f749-bd5b-444e-b2be-945d9c2b0c6b'
const MS_REDIRECT_URI = 'https://cmahillo.github.io/productividapp-mobile/'
const MS_SCOPE = 'https://graph.microsoft.com/Calendars.ReadWrite offline_access'
const MS_BASE = 'https://login.microsoftonline.com/common/oauth2/v2.0'

interface MsTokens {
  access_token: string
  refresh_token: string
  expires_at: number
}

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

// Caché en memoria cargada al arrancar mediante initMicrosoftAuth().
// Preferences (SharedPreferences en Android) sobrevive a que Android mate el
// proceso y recree el WebView; localStorage del WebView no siempre lo hace.
let _msTokens: MsTokens | null = null

/** Carga los tokens del almacenamiento persistente a la caché en memoria.
 *  Debe llamarse una vez al arrancar, ANTES de cualquier isMicrosoftAuthenticated(). */
export async function initMicrosoftAuth(): Promise<void> {
  try {
    const { value } = await Preferences.get({ key: 'ms_tokens' })
    _msTokens = value ? JSON.parse(value) as MsTokens : null
  } catch {
    _msTokens = null
  }
}

export function getMsTokens(): MsTokens | null {
  return _msTokens
}

async function saveMsTokens(t: MsTokens): Promise<void> {
  _msTokens = t
  await Preferences.set({ key: 'ms_tokens', value: JSON.stringify(t) })
}

async function clearMsTokens(): Promise<void> {
  _msTokens = null
  await Preferences.remove({ key: 'ms_tokens' })
}

export function isMicrosoftAuthenticated(): boolean {
  return !!_msTokens?.refresh_token
}

// Margen de refresco. Debe ser MENOR que el periodo del auto-sync (2 min) para
// que no coincidan y provoquen refrescos en cascada.
const REFRESH_MARGIN_MS = 2 * 60 * 1000

// Single-flight: varias llamadas concurrentes comparten el mismo POST de
// refresco. Sin esto, Microsoft rechaza los refrescos sobrantes y la sesión
// se borraba sola cada pocos minutos.
let msRefreshFlight: Promise<string | null> | null = null

export async function getMicrosoftAccessToken(): Promise<string | null> {
  const t = getMsTokens()
  if (!t) return null
  if (t.expires_at - Date.now() > REFRESH_MARGIN_MS) return t.access_token
  if (msRefreshFlight) return msRefreshFlight
  msRefreshFlight = refreshMsToken(t.refresh_token)
    .finally(() => { msRefreshFlight = null })
  return msRefreshFlight
}

/** Refresca el token de Microsoft en el arranque si está caducado o a punto de
 *  caducar, para que la primera carga de eventos no dependa de un refresco en
 *  caliente. Mismo patrón que proactiveRefresh() de auth.ts. */
export async function proactiveRefreshMicrosoft(): Promise<void> {
  const t = getMsTokens()
  if (!t?.refresh_token) return
  if (t.expires_at - Date.now() > REFRESH_MARGIN_MS) return
  await getMicrosoftAccessToken()
}

// Tolerancia a `invalid_grant` puntual: un invalid_grant aislado puede venir de
// una carrera entre dos refrescos con el mismo token, no de una revocación real.
// Solo se borra la sesión tras 3 fallos CONSECUTIVOS; un refresco correcto
// resetea el contador.
const MAX_CONSECUTIVE_INVALID_GRANT = 3
let msInvalidGrantCount = 0

async function refreshMsToken(refreshToken: string): Promise<string | null> {
  let res: Response
  try {
    res = await fetch(`${MS_BASE}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: MS_CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        scope: MS_SCOPE,
      }),
    })
  } catch (e) {
    // Error de red transitorio: no se toca la sesión.
    console.warn('[ms-auth] Refresco fallido por red, sesión preservada', e)
    return null
  }

  if (!res.ok) {
    let errorCode = ''
    try {
      const body = await res.json() as { error?: string }
      errorCode = body.error ?? ''
    } catch { /* respuesta no JSON */ }
    if (errorCode === 'invalid_grant') {
      msInvalidGrantCount++
      if (msInvalidGrantCount >= MAX_CONSECUTIVE_INVALID_GRANT) {
        console.warn('[ms-auth] invalid_grant x%d: se limpia la sesión de Microsoft', msInvalidGrantCount)
        msInvalidGrantCount = 0
        await clearMsTokens()
      } else {
        console.warn('[ms-auth] invalid_grant %d/%d, sesión preservada', msInvalidGrantCount, MAX_CONSECUTIVE_INVALID_GRANT)
      }
    } else {
      console.warn('[ms-auth] Refresco fallido, sesión preservada', res.status, errorCode)
    }
    return null
  }

  msInvalidGrantCount = 0
  const data = await res.json() as { access_token: string; refresh_token?: string; expires_in: number }
  const current = getMsTokens()
  const updated: MsTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? current?.refresh_token ?? '',
    expires_at: Date.now() + data.expires_in * 1000,
  }
  await saveMsTokens(updated)
  return data.access_token
}

const PKCE_KEY = 'ms_pkce_v'

/** El verifier tiene que sobrevivir al salto al navegador externo: en nativo va
 *  a Preferences, porque Chrome Custom Tabs no comparte localStorage con la app. */
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

export async function startMicrosoftAuth(): Promise<void> {
  const { verifier, challenge } = await generatePKCE()
  await savePkceVerifier(verifier)
  // `cap.` -> el relé de GitHub Pages devuelve el código a la app por deep link.
  const stateValue = Capacitor.isNativePlatform() ? 'cap.ms' : 'ms'
  const params = new URLSearchParams({
    client_id: MS_CLIENT_ID,
    redirect_uri: MS_REDIRECT_URI,
    response_type: 'code',
    scope: MS_SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    response_mode: 'query',
    state: stateValue,
  })
  const authUrl = `${MS_BASE}/authorize?${params}`
  if (Capacitor.isNativePlatform()) {
    await Browser.open({ url: authUrl })
  } else {
    window.location.href = authUrl
  }
}

// True si el último intercambio de código por token falló por red o por un 5xx
// (reintentable), no por un error OAuth explícito. Lo consulta App.tsx.
let _lastExchangeRetryable = false
export function wasMsExchangeRetryable(): boolean { return _lastExchangeRetryable }

export async function handleMicrosoftCallback(): Promise<boolean> {
  _lastExchangeRetryable = false
  const code = new URLSearchParams(window.location.search).get('code')
  const verifier = await readPkceVerifier()
  if (!code || !verifier) return false

  let res: Response
  try {
    res = await fetch(`${MS_BASE}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: MS_CLIENT_ID,
        redirect_uri: MS_REDIRECT_URI,
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        scope: MS_SCOPE,
      }),
    })
  } catch (e) {
    // Sin red al volver de Chrome Custom Tabs: reintentable, y el verifier se
    // conserva porque el reintento lo necesita.
    console.warn('[ms-auth] Token exchange sin red, reintentable', e)
    _lastExchangeRetryable = true
    return false
  }

  if (!res.ok) {
    const body = await res.text()
    _lastExchangeRetryable = res.status >= 500 || res.status === 429
    console.error('[ms-auth] Token exchange failed', res.status, body)
    if (!_lastExchangeRetryable) await clearPkceVerifier()
    return false
  }

  const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number }
  await saveMsTokens({ access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + data.expires_in * 1000 })
  msInvalidGrantCount = 0
  await clearPkceVerifier()
  window.history.replaceState({}, '', window.location.pathname)
  return true
}

export async function logoutMicrosoft(): Promise<void> {
  await clearMsTokens()
}
