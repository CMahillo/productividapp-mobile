import { getGoogleCalendarToken } from './googleCalendarAuth'
import type { CalendarEvent } from './types'

export async function fetchGoogleCalendarEvents(
  start: Date,
  end: Date
): Promise<CalendarEvent[]> {
  const token = await getGoogleCalendarToken()
  if (!token) return []

  const params = new URLSearchParams({
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
  })

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )

  if (!res.ok) return []

  const data = await res.json() as {
    items?: Array<{
      id: string
      summary?: string
      start?: { dateTime?: string; date?: string }
      end?: { dateTime?: string; date?: string }
      htmlLink?: string
    }>
  }

  return (data.items ?? []).map(ev => ({
    id: ev.id,
    title: ev.summary ?? '(Sin título)',
    start: ev.start?.dateTime ?? ev.start?.date ?? '',
    end: ev.end?.dateTime ?? ev.end?.date ?? '',
    allDay: !ev.start?.dateTime,
    source: 'google' as const,
    webLink: ev.htmlLink,
  }))
}
