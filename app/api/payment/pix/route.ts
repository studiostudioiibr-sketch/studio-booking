import { NextRequest, NextResponse } from 'next/server'
import { getReservationById } from '@/lib/google-sheets'
import { createPixCharge } from '@/lib/pagbank'
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
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = schema.safeParse(body)

    if (!parsed.success) {
      const first = parsed.error.flatten().fieldErrors
      const msg =
        first.tax_id?.[0] ??
        first.reservation_id?.[0] ??
        'Dados inválidos'
      return NextResponse.json({ error: msg }, { status: 400 })
    }

    const { reservation_id, tax_id } = parsed.data

    // Load reservation
    const result = await getReservationById(reservation_id)
    if (!result) {
      return NextResponse.json({ error: 'Reserva não encontrada' }, { status: 404 })
    }

    const { reservation } = result

    // Check if HOLD is still valid
    if (reservation.status !== 'HOLD') {
      return NextResponse.json({ error: 'Reserva não está em HOLD' }, { status: 400 })
    }
    if (new Date(reservation.expires_at) <= new Date()) {
      return NextResponse.json({ error: 'Pré-reserva expirada. Por favor, refaça o agendamento.' }, { status: 410 })
    }

    // Calculate remaining minutes for PIX expiration (sync with HOLD expiry)
    const minutesLeft = Math.max(
      1,
      Math.floor((new Date(reservation.expires_at).getTime() - Date.now()) / 60000)
    )

    // Create PagBank PIX charge
    const pix = await createPixCharge({
      reservation_id: reservation.id,
      total_cents: reservation.total_cents,
      cliente_nome: reservation.cliente_nome,
      cliente_email: reservation.cliente_email,
      customer_tax_id: tax_id,
      expires_in_minutes: minutesLeft,
    })

    return NextResponse.json({
      qr_code_text: pix.qr_code_text,
      qr_code_image_url: pix.qr_code_image_url,
      expires_at: pix.expires_at,
      transaction_id: pix.transaction_id,
    })
  } catch (err) {
    console.error('[POST /api/payment/pix]', err)
    return NextResponse.json(
      { error: publicErrorMessage(err, 'Erro ao gerar PIX') },
      { status: 500 }
    )
  }
}
