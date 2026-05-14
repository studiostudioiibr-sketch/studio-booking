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
import { sendMetaPurchaseEvent } from '@/lib/meta/capi'

export async function POST(req: NextRequest) {
  let reservation_id = ''
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

    reservation_id = event?.order?.reference_id ?? ''
    const gateway_tx_id = event.order.id

    if (!reservation_id) {
      return NextResponse.json({ received: true, note: 'missing reservation reference' })
    }

    // Check if already confirmed (idempotent)
    const existing = await getReservationById(reservation_id)
    if (existing?.reservation.status === 'CONFIRMADO') {
      const confirmed = existing.reservation
      console.log('[webhook/pagbank] already confirmed; reconciling side effects:', reservation_id)

      const [calendarResult, emailResult] = await Promise.allSettled([
        createConfirmedCalendarEvent({
          reservation_id: confirmed.id,
          source: 'webhook-reconcile',
          slot_datetime: confirmed.slot_datetime,
          cliente_nome: confirmed.cliente_nome,
          cliente_email: confirmed.cliente_email,
          addons: JSON.parse(confirmed.addons || '[]'),
        }),
        sendConfirmationEmail(confirmed),
      ])

      if (calendarResult.status === 'rejected') {
        console.error('[webhook/pagbank] calendar reconcile failed', {
          reservation_id,
          error:
            calendarResult.reason instanceof Error
              ? calendarResult.reason.message
              : String(calendarResult.reason),
        })
      }
      if (emailResult.status === 'rejected') {
        console.error('[webhook/pagbank] email reconcile failed', {
          reservation_id,
          error:
            emailResult.reason instanceof Error
              ? emailResult.reason.message
              : String(emailResult.reason),
        })
      }

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

    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '')

    const [calendarResult, emailResult, metaResult] = await Promise.allSettled([
      createConfirmedCalendarEvent({
        reservation_id: confirmed.id,
        source: 'webhook',
        slot_datetime: confirmed.slot_datetime,
        cliente_nome: confirmed.cliente_nome,
        cliente_email: confirmed.cliente_email,
        addons: JSON.parse(confirmed.addons || '[]'),
      }),
      sendConfirmationEmail(confirmed),
      sendMetaPurchaseEvent({
        reservationId: confirmed.id,
        totalCents: confirmed.total_cents,
        source: 'pix-webhook',
        eventSourceUrl: appUrl ? `${appUrl}/checkout` : undefined,
        email: confirmed.cliente_email,
        phone: confirmed.cliente_telefone,
        clientIpAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
        clientUserAgent: req.headers.get('user-agent') ?? undefined,
      }),
    ])

    if (calendarResult.status === 'rejected') {
      console.error('[webhook/pagbank] calendar failed', {
        reservation_id,
        error:
          calendarResult.reason instanceof Error
            ? calendarResult.reason.message
            : String(calendarResult.reason),
      })
    }

    if (emailResult.status === 'rejected') {
      console.error('[webhook/pagbank] email failed', {
        reservation_id,
        error:
          emailResult.reason instanceof Error
            ? emailResult.reason.message
            : String(emailResult.reason),
      })
    }

    if (metaResult.status === 'rejected') {
      console.error('[webhook/pagbank] meta-capi failed', {
        reservation_id,
        error:
          metaResult.reason instanceof Error
            ? metaResult.reason.message
            : String(metaResult.reason),
      })
    } else if (!metaResult.value.ok) {
      console.error('[webhook/pagbank] meta-capi request rejected', {
        reservation_id,
        status_code: metaResult.value.statusCode,
        error: metaResult.value.error,
      })
    }

    console.log('[webhook/pagbank] Confirmed:', reservation_id)
    return NextResponse.json({ received: true })
  } catch (err) {
    console.error('[webhook/pagbank]', {
      reservation_id,
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
