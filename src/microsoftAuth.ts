// Azure App Registration shared with the desktop app.
// Prerequisite: add https://cmahillo.github.io/productividapp-mobile/ as a
// Single-page application redirect URI in the Azure portal under this client ID.
const MS_CLIENT_ID = 'ed31f749-bd5b-444e-b2be-945d9c2b0c6b'
const MS_REDIRECT_URI = 'https://cmahillo.github.io/productividapp-mobile/'
const MS_SCOPE = 'https://graph.microsoft.com/Calendars.Read offline_access'
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

export function getMsTokens(): MsTokens | null {
  try { return JSON.parse(localStorage.getItem('ms_tokens') ?? 'null') } catch { return null }
}

function saveMsTokens(t: MsTokens): void {
  localStorage.setItem('ms_tokens', JSON.stringify(t))
}

export function isMicrosoftAuthenticated(): boolean {
  return !!getMsTokens()?.refresh_token
}

export async function getMicrosoftAccessToken(): Promise<string | null> {
  const t = getMsTokens()
  if (!t) return null
  if (t.expires_at - Date.now() > 5 * 60 * 1000) return t.access_token
  return refreshMsToken(t.refresh_token)
}

async function refreshMsToken(refreshToken: string): Promise<string | null> {
  const res = await fetch(`${MS_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: MS_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: MS_SCOPE,
    }),
  })
  if (!res.ok) { localStorage.removeItem('ms_tokens'); return null }
  const data = await res.json() as { access_token: string; refresh_token?: string; expires_in: number }
  const current = getMsTokens()
  const updated: MsTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? current?.refresh_token ?? '',
    expires_at: Date.now() + data.expires_in * 1000,
  }
  saveMsTokens(updated)
  return data.access_token
}

export async function startMicrosoftAuth(): Promise<void> {
  const { verifier, challenge } = await generatePKCE()
  localStorage.setItem('ms_pkce_v', verifier)
  const params = new URLSearchParams({
    client_id: MS_CLIENT_ID,
    redirect_uri: MS_REDIRECT_URI,
    response_type: 'code',
    scope: MS_SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    response_mode: 'query',
    state: 'ms',
  })
  window.location.href = `${MS_BASE}/authorize?${params}`
}

export async function handleMicrosoftCallback(): Promise<boolean> {
  const code = new URLSearchParams(window.location.search).get('code')
  const verifier = localStorage.getItem('ms_pkce_v')
  if (!code || !verifier) return false

  const res = await fetch(`${MS_BASE}/token`, {
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

  if (!res.ok) {
    console.error('[ms-auth] Token exchange failed', res.status, await res.text())
    localStorage.removeItem('ms_pkce_v')
    return false
  }

  const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number }
  saveMsTokens({ access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + data.expires_in * 1000 })
  localStorage.removeItem('ms_pkce_v')
  window.history.replaceState({}, '', window.location.pathname)
  return true
}

export function logoutMicrosoft(): void {
  localStorage.removeItem('ms_tokens')
}
