import { Preferences } from '@capacitor/preferences'

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string
const CLIENT_SECRET = import.meta.env.VITE_GOOGLE_CLIENT_SECRET as string
const REDIRECT_URI = 'https://cmahillo.github.io/productividapp-mobile/'
const SCOPE = 'https://www.googleapis.com/auth/drive'

interface Tokens {
  access_token: string
  refresh_token: string
  expires_at: number
}

// In-memory cache loaded at startup via initAuth().
// Preferences (Android SharedPreferences) persists across process restarts;
// localStorage does not survive when Android kills and recreates the WebView.
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

// Load tokens from persistent storage into the in-memory cache.
// Must be called once at app startup before any auth checks.
export async function initAuth(): Promise<void> {
  const { value } = await Preferences.get({ key: 'g_tokens' })
  try { _tokens = value ? JSON.parse(value) as Tokens : null } catch { _tokens = null }
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
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: refreshToken })
  })
  if (!res.ok) { await logout(); return null }
  const data = await res.json() as { access_token: string; expires_in: number }
  const updated: Tokens = { ...getTokens()!, access_token: data.access_token, expires_at: Date.now() + data.expires_in * 1000 }
  await saveTokens(updated)
  return data.access_token
}

export async function startAuth(): Promise<void> {
  const { verifier, challenge } = await generatePKCE()
  localStorage.setItem('pkce_v', verifier)
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
    state: btoa(verifier).replace(/=/g, ''),
  })
  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

export async function handleCallback(): Promise<boolean> {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const state = params.get('state')

  // Primary: get verifier from localStorage
  let verifier = localStorage.getItem('pkce_v')

  // Fallback: recover verifier from state param (startAuth set state = btoa(verifier) without padding)
  // Needed when Android WebView's loadUrl() resets localStorage context across navigations
  if (!verifier && state) {
    try {
      const pad = '='.repeat((4 - (state.length % 4)) % 4)
      verifier = atob(state + pad)
    } catch {
      // ignore decode errors
    }
  }

  if (!code || !verifier) {
    const debug = { step: 'check', had_code: !!code, had_verifier: !!verifier, had_state: !!state }
    console.error('[auth] Missing code or verifier', debug)
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
    console.error('[auth] Token exchange failed', debug)
    localStorage.setItem('auth_last_error', JSON.stringify(debug))
    return false
  }

  const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number }
  await saveTokens({ access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + data.expires_in * 1000 })
  localStorage.removeItem('pkce_v')
  window.history.replaceState({}, '', window.location.pathname)
  return true
}

export async function logout(): Promise<void> {
  _tokens = null
  await Preferences.remove({ key: 'g_tokens' })
}
