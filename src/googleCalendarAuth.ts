const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string
const CLIENT_SECRET = import.meta.env.VITE_GOOGLE_CLIENT_SECRET as string
const REDIRECT_URI = 'https://cmahillo.github.io/productividapp-mobile/'
const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly'

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

export function getGCalTokens(): Tokens | null {
  try { return JSON.parse(localStorage.getItem('g_cal_tokens') ?? 'null') } catch { return null }
}

function saveGCalTokens(t: Tokens): void {
  localStorage.setItem('g_cal_tokens', JSON.stringify(t))
}

export function isGoogleCalendarAuthenticated(): boolean {
  return !!getGCalTokens()?.refresh_token
}

export async function getGoogleCalendarToken(): Promise<string | null> {
  const t = getGCalTokens()
  if (!t) return null
  if (t.expires_at - Date.now() > 5 * 60 * 1000) return t.access_token
  return refreshGCalToken(t.refresh_token)
}

async function refreshGCalToken(refreshToken: string): Promise<string | null> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: refreshToken }),
  })
  if (!res.ok) { localStorage.removeItem('g_cal_tokens'); return null }
  const data = await res.json() as { access_token: string; expires_in: number }
  const updated: Tokens = { ...getGCalTokens()!, access_token: data.access_token, expires_at: Date.now() + data.expires_in * 1000 }
  saveGCalTokens(updated)
  return data.access_token
}

export async function startGoogleCalendarAuth(): Promise<void> {
  const { verifier, challenge } = await generatePKCE()
  localStorage.setItem('g_cal_pkce_v', verifier)
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
    state: 'g_cal',
  })
  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

export async function handleGoogleCalendarCallback(): Promise<boolean> {
  const code = new URLSearchParams(window.location.search).get('code')
  const verifier = localStorage.getItem('g_cal_pkce_v')
  if (!code || !verifier) return false

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI, grant_type: 'authorization_code', code, code_verifier: verifier }),
  })
  if (!res.ok) {
    console.error('[g-cal-auth] Token exchange failed', res.status, await res.text())
    localStorage.removeItem('g_cal_pkce_v')
    return false
  }
  const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number }
  saveGCalTokens({ access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + data.expires_in * 1000 })
  localStorage.removeItem('g_cal_pkce_v')
  window.history.replaceState({}, '', window.location.pathname)
  return true
}

export function logoutGoogleCalendar(): void {
  localStorage.removeItem('g_cal_tokens')
}
