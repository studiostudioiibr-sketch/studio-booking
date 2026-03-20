import { google } from 'googleapis'
import { Slot } from './types'
import { getReservationsByDate } from './google-sheets'
import { format, parseISO } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'

const TZ = 'America/Sao_Paulo'

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
//   3. Return enriched Slot list

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
  const slotEvents = calendarEvents.filter(e =>
    e.summary?.toLowerCase().includes('slot') ||
    e.summary?.toLowerCase().includes('sessão') ||
    e.summary?.toLowerCase().includes('disponível')
  )

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

  // Fallback: if photographer hasn't set up Calendar events yet,
  // generate default time slots (09:00, 11:00, 14:00, 16:00, 18:00)
  if (slots.length === 0) {
    const defaultHours = [9, 11, 14, 16, 18]
    return defaultHours.map(hour => {
      const datetime = new Date(`${date}T${String(hour).padStart(2, '0')}:00:00-03:00`).toISOString()
      const label = `${String(hour).padStart(2, '0')}:00`

      const reservation = reservations.find(r => r.slot_datetime === datetime)
      let available = true
      let hold_expires_at: string | undefined = undefined

      if (reservation) {
        if (reservation.status === 'CONFIRMADO') {
          available = false
        } else if (reservation.status === 'HOLD') {
          const expiresAt = new Date(reservation.expires_at)
          if (expiresAt > now) {
            available = false
            hold_expires_at = reservation.expires_at
          }
        }
      }

      return { datetime, label, available, hold_expires_at }
    })
  }

  return slots
}

// ─── Confirm slot on Calendar (called after payment confirmed) ────────────────
// Creates a new event on the photographer's calendar marking the session booked

export async function createConfirmedCalendarEvent(params: {
  slot_datetime: string
  cliente_nome: string
  cliente_email: string
  addons: string[]
}): Promise<void> {
  const calendar = google.calendar({ version: 'v3', auth: getAuth() })
  const calendarId = process.env.GOOGLE_CALENDAR_ID!

  const start = new Date(params.slot_datetime)
  const end = new Date(start.getTime() + 60 * 60 * 1000) // 1 hour session

  const addonsLabel = params.addons.length > 0
    ? ` + ${params.addons.join(', ')}`
    : ''
  const hasMakeup = params.addons.includes('makeup')
  const hasStylist = params.addons.includes('stylist')
  const studioEmail = process.env.STUDIO_NOTIFICATION_EMAIL?.trim()
  const attendees = Array.from(new Set([studioEmail, params.cliente_email.trim()]))
    .filter(Boolean)
    .map(email => ({ email }))

  const slotZoned = toZonedTime(start, TZ)
  const slotDate = format(slotZoned, 'yyyy-MM-dd')
  const dayStart = new Date(`${slotDate}T00:00:00-03:00`).toISOString()
  const dayEnd = new Date(`${slotDate}T23:59:59-03:00`).toISOString()

  const eventsRes = await calendar.events.list({
    calendarId,
    timeMin: dayStart,
    timeMax: dayEnd,
    singleEvents: true,
    orderBy: 'startTime',
  })

  const targetStartIso = start.toISOString()
  const availabilityEvent = (eventsRes.data.items ?? []).find(event => {
    const summary = event.summary?.toLowerCase() ?? ''
    const isAvailability = summary.includes('slot') || summary.includes('disponível')
    const eventStartRaw = event.start?.dateTime
    if (!isAvailability || !eventStartRaw) return false
    return new Date(eventStartRaw).toISOString() === targetStartIso
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
      sendUpdates: 'all',
      requestBody: {
        summary: `Reservado · ${params.cliente_nome}`,
        description: availabilityDescription,
        start: { dateTime: start.toISOString(), timeZone: TZ },
        end: { dateTime: end.toISOString(), timeZone: TZ },
        colorId: '11',
        attendees,
      },
    })
    return
  }

  await calendar.events.insert({
    calendarId,
    sendUpdates: 'all',
    requestBody: {
      summary: `📸 Sessão: ${params.cliente_nome}${addonsLabel}`,
      description: availabilityDescription,
      start: { dateTime: start.toISOString(), timeZone: TZ },
      end: { dateTime: end.toISOString(), timeZone: TZ },
      colorId: '2', // sage green
      attendees,
    },
  })
}
