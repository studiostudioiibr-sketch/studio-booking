import { NextRequest, NextResponse } from 'next/server'
import { isPagBankPaymentConfirmed, parsePagBankWebhookPayload } from '@/lib/pagbank'
import {
  logPagBankWebhookParsed,
  logPagBankWebhookRaw,
  shouldLogPagBankIo,
} from '@/lib/pagbank-log'
import { confirmReservation, getReservationById } from '@/lib/google-sheets'
import { createConfirmedCalendarEvent } from '@/lib/google-calendar'
import { sendConfirmationEmail } from '@/lib/email'

export async function POST(req: NextRequest) {
  try {
    const raw = await req.text()
    logPagBankWebhookRaw(raw)
    const event = parsePagBankWebhookPayload(raw)

    if (!event) {
      if (!shouldLogPagBankIo()) {
        console.warn('[webhook/pagbank] Ignored body (non-JSON or unknown shape):', raw.slice(0, 280))
      } else {
        console.warn('[webhook/pagbank] Ignored body (unknown shape); full body logged above')
      }
      return NextResponse.json({ received: true, note: 'ignored' })
    }

    logPagBankWebhookParsed({
      event: event.event,
      orderId: event.order.id,
      referenceId: event.order.reference_id,
      orderStatus: event.order.status,
      chargesSummary: event.order.charges
        ?.map(c => `${c.id}:${c.status}`)
        .join('|'),
    })

    if (!isPagBankPaymentConfirmed(event)) {
      return NextResponse.json({ received: true })
    }

    const reservation_id = event?.order?.reference_id
    const gateway_tx_id = event.order.id

    if (!reservation_id) {
      return NextResponse.json({ received: true, note: 'missing reservation reference' })
    }

    // Check if already confirmed (idempotent)
    const existing = await getReservationById(reservation_id)
    if (existing?.reservation.status === 'CONFIRMADO') {
      return NextResponse.json({ received: true, note: 'already confirmed' })
    }

    const confirmed = await confirmReservation({
      reservation_id,
      gateway: 'pagbank',
      gateway_tx_id,
    })

    if (!confirmed) {
      console.error('[webhook/pagbank] Reservation not found:', reservation_id)
      return NextResponse.json({ error: 'Reservation not found' }, { status: 404 })
    }

    await Promise.all([
      createConfirmedCalendarEvent({
        slot_datetime: confirmed.slot_datetime,
        cliente_nome: confirmed.cliente_nome,
        cliente_email: confirmed.cliente_email,
        addons: JSON.parse(confirmed.addons || '[]'),
      }),
      sendConfirmationEmail(confirmed),
    ])

    console.log('[webhook/pagbank] Confirmed:', reservation_id)
    return NextResponse.json({ received: true })
  } catch (err) {
    console.error('[webhook/pagbank]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
