/**
 * Logs para homologação / Vercel Function Logs.
 * Sandbox: ativo por padrão. Produção: só com PAGBANK_LOG_IO=true.
 * Nunca logar Authorization / token.
 */

const DEFAULT_MAX = 16_384

export function shouldLogPagBankIo(): boolean {
  if (process.env.PAGBANK_LOG_IO === 'true' || process.env.PAGBANK_LOG_IO === '1') return true
  return process.env.PAGBANK_ENV !== 'production'
}

function maxChars(): number {
  const n = Number(process.env.PAGBANK_LOG_MAX_CHARS)
  return Number.isFinite(n) && n > 0 ? Math.min(n, 64_000) : DEFAULT_MAX
}

function truncate(s: string): string {
  const max = maxChars()
  if (s.length <= max) return s
  return `${s.slice(0, max)}…[truncated ${s.length - max} chars]`
}

/** Cópia do body de POST /orders com `encrypted` truncado (não altera o payload real). */
export function pagbankOrdersBodyForLog(body: Record<string, unknown>): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(body)) as Record<string, unknown>
  const charges = clone.charges
  if (Array.isArray(charges)) {
    for (const c of charges) {
      if (!c || typeof c !== 'object') continue
      const charge = c as Record<string, unknown>
      const pm = charge.payment_method as Record<string, unknown> | undefined
      const card = pm?.card as Record<string, unknown> | undefined
      if (!card) continue
      const enc = card.encrypted
      if (typeof enc === 'string' && enc.length > 0) {
        card.encrypted =
          enc.length <= 64 ? enc : `${enc.slice(0, 48)}…[${enc.length} chars]`
      }
    }
  }
  return clone
}

export function logPagBankOrdersRequest(kind: 'PIX' | 'CARD', body: Record<string, unknown>): void {
  if (!shouldLogPagBankIo()) return
  try {
    const safe = kind === 'CARD' ? pagbankOrdersBodyForLog(body) : body
    console.log(`[PagBank][orders][${kind}] request`, truncate(JSON.stringify(safe)))
  } catch {
    console.log(`[PagBank][orders][${kind}] request`, '[unserializable]')
  }
}

export function logPagBankOrdersResponse(kind: 'PIX' | 'CARD', status: number, responseText: string): void {
  if (!shouldLogPagBankIo()) return
  console.log(`[PagBank][orders][${kind}] response ${status}`, truncate(responseText))
}

export function logPagBankWebhookRaw(raw: string): void {
  if (!shouldLogPagBankIo()) return
  console.log('[webhook/pagbank] body', truncate(raw))
}

export function logPagBankWebhookParsed(meta: {
  event: string
  orderId: string
  referenceId: string
  orderStatus: string
  chargesSummary?: string
}): void {
  if (!shouldLogPagBankIo()) return
  console.log(
    '[webhook/pagbank] parsed',
    JSON.stringify({
      event: meta.event,
      order_id: meta.orderId,
      reference_id: meta.referenceId,
      order_status: meta.orderStatus,
      charges: meta.chargesSummary,
    })
  )
}
