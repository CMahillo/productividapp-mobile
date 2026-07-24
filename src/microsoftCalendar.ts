import { getMicrosoftAccessToken } from './microsoftAuth'
import type { CalendarEvent } from './types'

export async function fetchMicrosoftCalendarEvents(
  start: Date,
  end: Date
): Promise<CalendarEvent[]> {
  const token = await getMicrosoftAccessToken()
  if (!token) return []

  const params = new URLSearchParams({
    startDateTime: start.toISOString(),
    endDateTime: end.toISOString(),
    $select: 'id,subject,start,end,isAllDay',
    $top: '250',
    $orderby: 'start/dateTime',
  })

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/calendarView?${params}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Prefer: 'outlook.timezone="Europe/Madrid"',
      },
    }
  )

  if (!res.ok) return []

  const data = await res.json() as {
    value?: Array<{
      id: string
      subject?: string
      start?: { dateTime: string }
      end?: { dateTime: string }
      isAllDay?: boolean
      webLink?: string
    }>
  }

  return (data.value ?? []).map(ev => ({
    id: ev.id,
    title: ev.subject ?? '(Sin título)',
    start: ev.start?.dateTime ?? '',
    end: ev.end?.dateTime ?? '',
    allDay: ev.isAllDay ?? false,
    source: 'microsoft' as const,
    webLink: ev.webLink,
  }))
}

export async function createMicrosoftCalendarEvent(
  title: string,
  description: string,
  start: string,
  end: string
): Promise<{ success: boolean; error?: string }> {
  const token = await getMicrosoftAccessToken()
  if (!token) return { success: false, error: 'No hay sesión de Microsoft. Conéctala en el Calendario.' }

  try {
    const res = await fetch('https://graph.microsoft.com/v1.0/me/events', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'outlook.timezone="Europe/Madrid"',
      },
      body: JSON.stringify({
        subject: title,
        body: { contentType: 'text', content: description },
        start: { dateTime: start, timeZone: 'Europe/Madrid' },
        end: { dateTime: end, timeZone: 'Europe/Madrid' },
      }),
    })
    if (!res.ok) {
      const body = await res.json() as { error?: { message?: string } }
      if (res.status === 403) return { success: false, error: 'Sin permisos de escritura. Desconecta y vuelve a conectar Microsoft Calendar.' }
      return { success: false, error: body.error?.message ?? `Error ${res.status}` }
    }
    return { success: true }
  } catch (e) {
    return { success: false, error: String(e) }
  }
}
