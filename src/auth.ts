import { Preferences } from '@capacitor/preferences'
import { Browser } from '@capacitor/browser'
import { Capacitor } from '@capacitor/core'

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string
const CLIENT_SECRET = import.meta.env.VITE_GOOGLE_CLIENT_SECRET as string
const REDIRECT_URI = 'https://cmahillo.github.io/productividapp-mobile/'
const SCOPE = 'https://www.googleapis.com/auth/drive'

/** Prefijo del parámetro `state` que marca un login iniciado desde la app nativa.
 *  La página de GitHub Pages lo usa para decidir si reenvía el código a la app
 *  (deep link `productividapp://`) o si completa el login como PWA web. */
export const CAP_STATE_PREFIX = 'cap.'

/** Esquema del deep link registrado en AndroidManifest.xml */
export const DEEP_LINK_SCHEME = 'productividapp'

interface Tokens {
  access_token: string
  refresh_token: string
  expires_at: number
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

export async function getAccessToken(): Promise<string | null> {
  const t = getTokens()
  if (!t) return null
  if (t.expires_at - Date.now() > 5 * 60 * 1000) return t.access_token
  return refreshAccessToken(t.refresh_token)
}

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  let res: Response
  try {
    res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: refreshToken })
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
    console.error('[auth] refresh fallido', { status: res.status, revoked })
    if (revoked) await logout()
    return null
  }

  const data = await res.json() as { access_token: string; expires_in: number }
  const updated: Tokens = { ...getTokens()!, access_token: data.access_token, expires_at: Date.now() + data.expires_in * 1000 }
  await saveTokens(updated)
  return data.access_token
}

export async function startAuth(): Promise<void> {
  const { verifier, challenge } = await generatePKCE()
  localStorage.setItem('pkce_v', verifier)

  // El verifier ya es base64url (solo A-Za-z0-9-_), así que viaja intacto por la
  // query string sin riesgo de que un '+' se convierta en espacio.
  const state = isNative() ? `${CAP_STATE_PREFIX}${verifier}` : verifier

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
    state,
  })
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params}`

  if (isNative()) {
    // Google bloquea OAuth en WebViews embebidos (error 400 disallowed_useragent):
    // hay que salir a Chrome Custom Tabs.
    await Browser.open({ url })
  } else {
    window.location.href = url
  }
}

/** Recupera el code_verifier: primero de localStorage y, si no está, del propio
 *  parámetro `state` (startAuth lo mete ahí para sobrevivir a que el WebView
 *  pierda el contexto de localStorage entre navegaciones). */
function recoverVerifier(state: string | null): string | null {
  const stored = localStorage.getItem('pkce_v')
  if (stored) return stored
  if (!state) return null
  const raw = state.startsWith(CAP_STATE_PREFIX) ? state.slice(CAP_STATE_PREFIX.length) : state
  return raw.length > 0 ? raw : null
}

export async function handleCallback(): Promise<boolean> {
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

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI, grant_type: 'authorization_code', code, code_verifier: verifier })
  })
  if (!res.ok) {
    const body = await res.text()
    const debug = { step: 'token_exchange', status: res.status, body, redirect_uri: REDIRECT_URI, had_verifier: !!verifier }
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

  await saveTokens({ access_token: data.access_token, refresh_token: refresh, expires_at: Date.now() + data.expires_in * 1000 })
  localStorage.removeItem('pkce_v')
  localStorage.removeItem('auth_last_error')
  return true
}

export async function logout(): Promise<void> {
  _tokens = null
  await Preferences.remove({ key: 'g_tokens' })
}
