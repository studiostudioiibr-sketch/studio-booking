const EVENT_PREFIX = 'meta'

export function buildMetaEventId(eventName: string, reservationId: string) {
  const normalizedEvent = eventName.trim().toLowerCase()
  const normalizedReservationId = reservationId.trim().toLowerCase()
  return `${EVENT_PREFIX}:${normalizedEvent}:${normalizedReservationId}`
}
