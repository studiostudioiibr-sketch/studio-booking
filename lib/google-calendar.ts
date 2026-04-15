import { google } from 'googleapis'
import { MonthAvailabilityByDate, Slot } from './types'
import { slotMeetsMinimumLeadTime } from './booking-lead-time'
import { getReservationsByDate, getReservationsByMonth } from './google-sheets'
import { format, parseISO } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'

const TZ = 'America/Sao_Paulo'

function isAvailabilityEvent(summary: string | null | undefined): boolean {
  const text = summary?.toLowerCase() ?? ''
  return text.includes('slot') || text.includes('sessão') || text.includes('disponível')
}

function allowCalendarAttendees(): boolean {
  return process.env.GOOGLE_CALENDAR_ALLOW_ATTENDEES === 'true' || process.env.GOOGLE_CALENDAR_ALLOW_ATTENDEES === '1'
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!)
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/calendar.events'],
  })
}

// ─── Get available slots for a date ──────────────────────────────────────────
// Strategy:
//   1. Fetch all-day or timed events from Google Calendar for the date
//      (the photographer creates events like "Slot 09:00" for each opening)
//   2. Cross-reference with Sheets reservations (applying lazy expiration)
//   3. Return enriched Slot list (no default fallback slots)

export async function getSlotsForDate(date: string): Promise<Slot[]> {
  const calendar = google.calendar({ version: 'v3', auth: getAuth() })

  // Date range for the query (full day in São Paulo timezone)
  const dayStart = new Date(`${date}T00:00:00-03:00`).toISOString()
  const dayEnd = new Date(`${date}T23:59:59-03:00`).toISOString()

  const eventsRes = await calendar.events.list({
    calendarId: process.env.GOOGLE_CALENDAR_ID!,
    timeMin: dayStart,
    timeMax: dayEnd,
    singleEvents: true,
    orderBy: 'startTime',
  })

  const calendarEvents = eventsRes.data.items ?? []

  // Filter events that look like slots (title starts with "Slot" or "slot")
  const slotEvents = calendarEvents.filter(e => isAvailabilityEvent(e.summary))

  // Fetch reservations for this date from Sheets (for lazy-expiration check)
  const reservations = await getReservationsByDate(date)
  const now = new Date()

  // Build slot list
  const slots: Slot[] = slotEvents.map(event => {
    const startRaw = event.start?.dateTime ?? event.start?.date ?? ''
    const startDate = parseISO(startRaw)
    const zonedStart = toZonedTime(startDate, TZ)
    const datetime = startDate.toISOString()
    const label = format(zonedStart, 'HH:mm')

    // Check if there's an active reservation for this slot
    const reservation = reservations.find(r => r.slot_datetime === datetime)

    let available = true
    let hold_expires_at: string | undefined = undefined

    if (reservation) {
      if (reservation.status === 'CONFIRMADO') {
        available = false
      } else if (reservation.status === 'HOLD') {
        const expiresAt = new Date(reservation.expires_at)
        if (expiresAt > now) {
          // Active hold — slot is temporarily unavailable
          available = false
          hold_expires_at = reservation.expires_at
        }
        // If expired: treat as available (lazy expiration)
      }
    }

    return { datetime, label, available, hold_expires_at }
  })

  return slots.filter(s => slotMeetsMinimumLeadTime(parseISO(s.datetime), now))
}

export async function getMonthAvailabilityByDate(month: string): Promise<MonthAvailabilityByDate> {
  const calendar = google.calendar({ version: 'v3', auth: getAuth() })
  const [yearStr, monthStr] = month.split('-')
  const year = Number(yearStr)
  const monthIndex = Number(monthStr) - 1

  const firstDay = new Date(year, monthIndex, 1)
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()
  const monthStart = new Date(`${month}-01T00:00:00-03:00`).toISOString()
  const monthEnd = new Date(year, monthIndex + 1, 0, 23, 59, 59)
  const monthEndIso = new Date(
    `${format(monthEnd, 'yyyy-MM-dd')}T23:59:59-03:00`
  ).toISOString()

  const availabilityByDate: MonthAvailabilityByDate = {}
  for (let d = 0; d < daysInMonth; d += 1) {
    const date = new Date(firstDay.getFullYear(), firstDay.getMonth(), d + 1)
    availabilityByDate[format(date, 'yyyy-MM-dd')] = false
  }

  const [eventsRes, reservations] = await Promise.all([
    calendar.events.list({
      calendarId: process.env.GOOGLE_CALENDAR_ID!,
      timeMin: monthStart,
      timeMax: monthEndIso,
      singleEvents: true,
      orderBy: 'startTime',
    }),
    getReservationsByMonth(month),
  ])

  const now = new Date()
  const blockedSlots = new Set(
    reservations
      .filter(r => {
        if (r.status === 'CONFIRMADO') return true
        if (r.status === 'HOLD') return new Date(r.expires_at) > now
        return false
      })
      .map(r => r.slot_datetime)
  )

  for (const event of eventsRes.data.items ?? []) {
    if (!isAvailabilityEvent(event.summary)) continue
    const startRaw = event.start?.dateTime ?? event.start?.date
    if (!startRaw) continue

    const startDate = parseISO(startRaw)
    if (!slotMeetsMinimumLeadTime(startDate, now)) continue

    const dateKey = format(toZonedTime(startDate, TZ), 'yyyy-MM-dd')
    if (!(dateKey in availabilityByDate)) continue

    if (!blockedSlots.has(startDate.toISOString())) {
      availabilityByDate[dateKey] = true
    }
  }

  return availabilityByDate
}

// ─── Confirm slot on Calendar (called after payment confirmed) ────────────────
// Creates a new event on the photographer's calendar marking the session booked

export async function createConfirmedCalendarEvent(params: {
  reservation_id?: string
  slot_datetime: string
  cliente_nome: string
  cliente_email: string
  addons: string[]
  source?: 'card' | 'webhook' | 'webhook-reconcile'
}): Promise<void> {
  const logMeta = {
    reservation_id: params.reservation_id ?? '',
    source: params.source ?? 'unknown',
    slot_datetime: params.slot_datetime,
  }

  try {
    const calendar = google.calendar({ version: 'v3', auth: getAuth() })
    const calendarId = process.env.GOOGLE_CALENDAR_ID!

    const start = new Date(params.slot_datetime)
    const end = new Date(start.getTime() + 60 * 60 * 1000) // 1 hour session

    const addonsLabel = params.addons.length > 0
      ? ` + ${params.addons.join(', ')}`
      : ''
    const hasMakeup = params.addons.includes('makeup')
    const hasStylist = params.addons.includes('stylist')
    const studioEmail = process.env.STUDIO_NOTIFICATION_EMAIL?.trim() ?? ''
    const attendeeEmails = Array.from(new Set([studioEmail, params.cliente_email.trim()]))
      .map(e => e.trim())
      .filter(Boolean)
    const includeAttendees = allowCalendarAttendees() && attendeeEmails.length > 0
    const attendees = includeAttendees
      ? attendeeEmails.map(email => ({ email }))
      : undefined
    const sendUpdates = includeAttendees ? 'all' : 'none'

    const slotZoned = toZonedTime(start, TZ)
    const slotDate = format(slotZoned, 'yyyy-MM-dd')
    const dayStart = new Date(`${slotDate}T00:00:00-03:00`).toISOString()
    const dayEnd = new Date(`${slotDate}T23:59:59-03:00`).toISOString()

    console.log('[calendar/confirm] start', {
      ...logMeta,
      target_start_iso: start.toISOString(),
      day_start: dayStart,
      day_end: dayEnd,
      include_attendees: includeAttendees,
      send_updates: sendUpdates,
    })

    const eventsRes = await calendar.events.list({
      calendarId,
      timeMin: dayStart,
      timeMax: dayEnd,
      singleEvents: true,
      orderBy: 'startTime',
    })

    const targetStartIso = start.toISOString()
    const events = eventsRes.data.items ?? []
    const availabilityEvent = events.find(event => {
      const summary = event.summary?.toLowerCase() ?? ''
      const isAvailability = summary.includes('slot') || summary.includes('disponível')
      const eventStartRaw = event.start?.dateTime
      if (!isAvailability || !eventStartRaw) return false
      return new Date(eventStartRaw).toISOString() === targetStartIso
    })

    console.log('[calendar/confirm] availability lookup', {
      ...logMeta,
      events_in_day: events.length,
      matched_event_id: availabilityEvent?.id ?? '',
      matched_event_summary: availabilityEvent?.summary ?? '',
    })

    const availabilityDescription = [
      'Reserva confirmada via Studio II Booking',
      `Cliente: ${params.cliente_nome}`,
      `Maquiadora: ${hasMakeup ? 'Sim' : 'Não'}`,
      `Figurinista: ${hasStylist ? 'Sim' : 'Não'}`,
    ].join('\n')

    if (availabilityEvent?.id) {
      await calendar.events.patch({
        calendarId,
        eventId: availabilityEvent.id,
        sendUpdates,
        requestBody: {
          summary: `Reservado · ${params.cliente_nome}`,
          description: availabilityDescription,
          start: { dateTime: start.toISOString(), timeZone: TZ },
          end: { dateTime: end.toISOString(), timeZone: TZ },
          colorId: '11',
          ...(attendees ? { attendees } : {}),
        },
      })
      console.log('[calendar/confirm] patch success', {
        ...logMeta,
        event_id: availabilityEvent.id,
      })
      return
    }

    const insertRes = await calendar.events.insert({
      calendarId,
      sendUpdates,
      requestBody: {
        summary: `📸 Sessão: ${params.cliente_nome}${addonsLabel}`,
        description: availabilityDescription,
        start: { dateTime: start.toISOString(), timeZone: TZ },
        end: { dateTime: end.toISOString(), timeZone: TZ },
        colorId: '2', // sage green
        ...(attendees ? { attendees } : {}),
      },
    })

    console.log('[calendar/confirm] insert success (fallback)', {
      ...logMeta,
      event_id: insertRes.data.id ?? '',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[calendar/confirm] failed', {
      ...logMeta,
      error: message,
    })
    throw err
  }
}
