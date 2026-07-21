const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string
const CLIENT_SECRET = import.meta.env.VITE_GOOGLE_CLIENT_SECRET as string
const REDIRECT_URI = 'https://cmahillo.github.io/productividapp-mobile/'
const SCOPE = 'https://www.googleapis.com/auth/drive'

interface Tokens {
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

export function getTokens(): Tokens | null {
  try { return JSON.parse(localStorage.getItem('g_tokens') ?? 'null') } catch { return null }
}

function saveTokens(t: Tokens): void {
  localStorage.setItem('g_tokens', JSON.stringify(t))
}

export function isAuthenticated(): boolean {
  return !!getTokens()?.refresh_token
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
  if (!res.ok) { localStorage.removeItem('g_tokens'); return null }
  const data = await res.json() as { access_token: string; expires_in: number }
  const updated: Tokens = { ...getTokens()!, access_token: data.access_token, expires_at: Date.now() + data.expires_in * 1000 }
  saveTokens(updated)
  return data.access_token
}

export async function startAuth(): Promise<void> {
  const { verifier, challenge } = await generatePKCE()
  localStorage.setItem('pkce_v', verifier)  // sessionStorage se pierde al redirigir en móvil
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent'
  })
  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

export async function handleCallback(): Promise<boolean> {
  const code = new URLSearchParams(window.location.search).get('code')
  const verifier = localStorage.getItem('pkce_v')
  if (!code || !verifier) {
    const debug = { step: 'check', had_code: !!code, had_verifier: !!verifier }
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
  saveTokens({ access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + data.expires_in * 1000 })
  localStorage.removeItem('pkce_v')
  window.history.replaceState({}, '', window.location.pathname)
  return true
}

export function logout(): void {
  localStorage.removeItem('g_tokens')
}
