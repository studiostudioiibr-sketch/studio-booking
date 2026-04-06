/** Minimum time between "now" and session start for new bookings (20 minutes). */
export const BOOKING_MIN_LEAD_MS = 20 * 60 * 1000

export function slotMeetsMinimumLeadTime(slotStart: Date, now: Date = new Date()): boolean {
  return slotStart.getTime() - now.getTime() >= BOOKING_MIN_LEAD_MS
}
