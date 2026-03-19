import { NextRequest, NextResponse } from 'next/server'
import { getReservationById, confirmReservation } from '@/lib/google-sheets'
import { createCardCharge } from '@/lib/pagbank'
import { createConfirmedCalendarEvent } from '@/lib/google-calendar'
import { sendConfirmationEmail } from '@/lib/email'
import { z } from 'zod'

const schema = z.object({
  reservation_id: z.string().uuid(),
  card: z.object({
    number: z.string().min(13),
    holder: z.string().min(2),
    expiry_month: z.string().length(2),
    expiry_year: z.string().length(4),
    cvv: z.string().min(3).max(4),
  }),
  installments: z.number().min(1).max(2).default(1),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = schema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: 'Dados de cartão inválidos' }, { status: 400 })
    }

    const { reservation_id, card, installments } = parsed.data

    // Load reservation
    const result = await getReservationById(reservation_id)
    if (!result) {
      return NextResponse.json({ error: 'Reserva não encontrada' }, { status: 404 })
    }

    const { reservation } = result

    // Check HOLD validity
    if (reservation.status !== 'HOLD') {
      return NextResponse.json({ error: 'Reserva não está em HOLD' }, { status: 400 })
    }
    if (new Date(reservation.expires_at) <= new Date()) {
      return NextResponse.json({ error: 'Pré-reserva expirada. Refaça o agendamento.' }, { status: 410 })
    }

    // Charge via PagBank
    const charge = await createCardCharge({
      reservation_id: reservation.id,
      total_cents: reservation.total_cents,
      cliente_nome: reservation.cliente_nome,
      cliente_email: reservation.cliente_email,
      card,
      installments,
    })

    if (charge.status !== 'APROVADO') {
      return NextResponse.json(
        { error: `Pagamento ${charge.status.toLowerCase()}: ${charge.message}` },
        { status: 402 }
      )
    }

    // Confirm reservation in Sheets
    const confirmed = await confirmReservation({
      reservation_id: reservation.id,
      gateway: 'pagbank',
      gateway_tx_id: charge.transaction_id,
    })

    if (confirmed) {
      // Fire and forget (don't block response on these)
      Promise.all([
        createConfirmedCalendarEvent({
          slot_datetime: confirmed.slot_datetime,
          cliente_nome: confirmed.cliente_nome,
          addons: JSON.parse(confirmed.addons || '[]'),
        }),
        sendConfirmationEmail(confirmed),
      ]).catch(err => console.error('[post-confirm]', err))
    }

    return NextResponse.json({ status: 'APROVADO', reservation_id })
  } catch (err) {
    console.error('[POST /api/payment/card]', err)
    return NextResponse.json({ error: 'Erro ao processar pagamento' }, { status: 500 })
  }
}
