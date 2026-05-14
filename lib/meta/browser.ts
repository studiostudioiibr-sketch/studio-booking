'use client'

import { buildMetaEventId } from '@/lib/meta/event-id'

type FbqTrackOptions = {
  eventID?: string
}

type FbqTrackFn = (
  command: 'track',
  eventName: string,
  parameters?: Record<string, unknown>,
  options?: FbqTrackOptions
) => void

declare global {
  interface Window {
    fbq?: FbqTrackFn
    _fbq?: FbqTrackFn
  }
}

type TrackMetaEventInput = {
  eventName: string
  reservationId?: string
  parameters?: Record<string, unknown>
  eventId?: string
  dedupe?: boolean
}

function canUseBrowserApis() {
  return typeof window !== 'undefined'
}

function isMetaDebugEnabled() {
  return process.env.NEXT_PUBLIC_META_DEBUG === 'true'
}

function hasPixelConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_META_PIXEL_ID)
}

function buildDedupeKey(eventName: string, reservationId?: string) {
  const normalizedEvent = eventName.trim().toLowerCase()
  const normalizedReservationId = (reservationId ?? 'anonymous').trim().toLowerCase()
  return `meta_sent:${normalizedEvent}:${normalizedReservationId}`
}

function markEventSent(dedupeKey: string) {
  try {
    sessionStorage.setItem(dedupeKey, '1')
    return true
  } catch {
    return false
  }
}

function hasSentEvent(dedupeKey: string) {
  try {
    return sessionStorage.getItem(dedupeKey) === '1'
  } catch {
    return false
  }
}

export function trackMetaEvent({
  eventName,
  reservationId,
  parameters,
  eventId,
  dedupe = true,
}: TrackMetaEventInput) {
  if (!canUseBrowserApis() || !hasPixelConfigured() || typeof window.fbq !== 'function') return false

  const dedupeKey = buildDedupeKey(eventName, reservationId)
  if (dedupe && hasSentEvent(dedupeKey)) {
    if (isMetaDebugEnabled()) {
      console.info('[meta][browser] skipped duplicate event', { eventName, reservationId, dedupeKey })
    }
    return false
  }

  const resolvedEventId =
    eventId ??
    (reservationId ? buildMetaEventId(eventName, reservationId) : undefined)

  const options: FbqTrackOptions | undefined = resolvedEventId
    ? { eventID: resolvedEventId }
    : undefined

  window.fbq('track', eventName, parameters, options)

  if (dedupe) {
    markEventSent(dedupeKey)
  }

  if (isMetaDebugEnabled()) {
    console.info('[meta][browser] event sent', {
      eventName,
      reservationId,
      eventId: resolvedEventId,
      parameters,
    })
  }
  return true
}
