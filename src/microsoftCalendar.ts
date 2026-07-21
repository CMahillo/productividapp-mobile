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
    }>
  }

  return (data.value ?? []).map(ev => ({
    id: ev.id,
    title: ev.subject ?? '(Sin título)',
    start: ev.start?.dateTime ?? '',
    end: ev.end?.dateTime ?? '',
    allDay: ev.isAllDay ?? false,
    source: 'microsoft' as const,
  }))
}
