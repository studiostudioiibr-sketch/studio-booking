import { createHash } from 'crypto'
import { buildMetaEventId } from '@/lib/meta/event-id'

type SendMetaPurchaseEventInput = {
  reservationId: string
  totalCents: number
  source: 'card' | 'pix-webhook'
  eventSourceUrl?: string
  email?: string
  phone?: string
  taxId?: string
  clientIpAddress?: string
  clientUserAgent?: string
}

type MetaCapiResult = {
  ok: boolean
  statusCode?: number
  error?: string
}

const META_GRAPH_VERSION = 'v22.0'
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504])

function normalizeValue(value: string) {
  return value.trim().toLowerCase()
}

function normalizeDigits(value: string) {
  return value.replace(/\D/g, '')
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function maybeHashedValue(value: string | undefined, normalizer: (value: string) => string) {
  const normalized = value ? normalizer(value) : ''
  return normalized ? sha256(normalized) : undefined
}

function getMetaConfig() {
  const pixelId = process.env.META_PIXEL_ID ?? process.env.NEXT_PUBLIC_META_PIXEL_ID
  const accessToken = process.env.META_ACCESS_TOKEN
  const testEventCode = process.env.META_TEST_EVENT_CODE
  return { pixelId, accessToken, testEventCode }
}

function shouldRetry(statusCode?: number) {
  return statusCode !== undefined && RETRYABLE_STATUS_CODES.has(statusCode)
}

async function wait(ms: number) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

export async function sendMetaPurchaseEvent(input: SendMetaPurchaseEventInput): Promise<MetaCapiResult> {
  const { pixelId, accessToken, testEventCode } = getMetaConfig()

  if (!pixelId || !accessToken) {
    return { ok: false, error: 'META_PIXEL_ID e/ou META_ACCESS_TOKEN ausentes' }
  }

  const eventId = buildMetaEventId('Purchase', input.reservationId)
  const endpoint = `https://graph.facebook.com/${META_GRAPH_VERSION}/${pixelId}/events`

  const externalIdSeed = input.taxId
    ? `${input.reservationId}:${normalizeDigits(input.taxId)}`
    : input.reservationId

  const userData = {
    em: maybeHashedValue(input.email, normalizeValue),
    ph: maybeHashedValue(input.phone, normalizeDigits),
    external_id: maybeHashedValue(externalIdSeed, normalizeValue),
    client_ip_address: input.clientIpAddress,
    client_user_agent: input.clientUserAgent,
  }

  const payload = {
    data: [
      {
        event_name: 'Purchase',
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        action_source: 'website',
        event_source_url: input.eventSourceUrl,
        user_data: userData,
        custom_data: {
          value: Number((input.totalCents / 100).toFixed(2)),
          currency: 'BRL',
          content_name: 'Studio II Session',
          order_id: input.reservationId,
          source: input.source,
        },
      },
    ],
    ...(testEventCode ? { test_event_code: testEventCode } : {}),
  }

  let attempts = 0
  while (attempts < 3) {
    attempts += 1
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      })

      if (response.ok) {
        return { ok: true, statusCode: response.status }
      }

      const errorText = await response.text().catch(() => 'Meta API request failed')
      const statusCode = response.status
      if (!shouldRetry(statusCode) || attempts >= 3) {
        return { ok: false, statusCode, error: errorText }
      }
    } catch (error) {
      if (attempts >= 3) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : 'Falha de rede no envio CAPI',
        }
      }
    }

    await wait(attempts * 200)
  }

  return { ok: false, error: 'Falha desconhecida ao enviar evento CAPI' }
}
