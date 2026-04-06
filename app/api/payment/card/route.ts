import { NextRequest, NextResponse } from 'next/server'
import { getReservationById, confirmReservation } from '@/lib/google-sheets'
import { createCardCharge } from '@/lib/pagbank'
import { createConfirmedCalendarEvent } from '@/lib/google-calendar'
import { sendConfirmationEmail } from '@/lib/email'
import { slotMeetsMinimumLeadTime } from '@/lib/booking-lead-time'
import { publicErrorMessage } from '@/lib/api-error-message'
import { z } from 'zod'

const taxIdSchema = z
  .string()
  .min(1, 'CPF ou CNPJ obrigatório')
  .transform(s => s.replace(/\D/g, ''))
  .refine(d => d.length === 11 || d.length === 14, 'CPF ou CNPJ deve ter 11 ou 14 dígitos')

const schema = z.object({
  reservation_id: z.string().uuid(),
  tax_id: taxIdSchema,
  encrypted: z.string().min(64, 'Payload criptografado inválido'),
  holder_name: z.string().min(2, 'Nome no cartão obrigatório'),
  holder_tax_id: z.string().optional(),
  installments: z.number().min(1).max(2).default(1),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = schema.safeParse(body)

    if (!parsed.success) {
      const f = parsed.error.flatten().fieldErrors
      const msg =
        f.tax_id?.[0] ??
        f.encrypted?.[0] ??
        f.holder_name?.[0] ??
        f.reservation_id?.[0] ??
        'Dados de cartão inválidos'
      return NextResponse.json({ error: msg }, { status: 400 })
    }

    const { reservation_id, tax_id, encrypted, holder_name, holder_tax_id, installments } =
      parsed.data

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

    if (!slotMeetsMinimumLeadTime(new Date(reservation.slot_datetime))) {
      return NextResponse.json(
        {
          error:
            'Este horário não está mais disponível para pagamento (mínimo de 20 minutos de antecedência). Refaça o agendamento.',
        },
        { status: 400 }
      )
    }

    // Charge via PagBank
    const charge = await createCardCharge({
      reservation_id: reservation.id,
      total_cents: reservation.total_cents,
      cliente_nome: reservation.cliente_nome,
      cliente_email: reservation.cliente_email,
      customer_tax_id: tax_id,
      encrypted,
      holder_name: holder_name,
      holder_tax_id: holder_tax_id,
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
          cliente_email: confirmed.cliente_email,
          addons: JSON.parse(confirmed.addons || '[]'),
        }),
        sendConfirmationEmail(confirmed),
      ]).catch(err => console.error('[post-confirm]', err))
    }

    return NextResponse.json({ status: 'APROVADO', reservation_id })
  } catch (err) {
    console.error('[POST /api/payment/card]', err)
    return NextResponse.json(
      { error: publicErrorMessage(err, 'Erro ao processar pagamento') },
      { status: 500 }
    )
  }
}
