import { format } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'

/** Only allow bookings for dates from tomorrow onward (São Paulo timezone). */
const BOOKING_TIMEZONE = 'America/Sao_Paulo'

export function slotMeetsMinimumLeadTime(slotStart: Date, now: Date = new Date()): boolean {
  const slotDateKey = format(toZonedTime(slotStart, BOOKING_TIMEZONE), 'yyyy-MM-dd')
  const todayDateKey = format(toZonedTime(now, BOOKING_TIMEZONE), 'yyyy-MM-dd')
  return slotDateKey > todayDateKey
}
