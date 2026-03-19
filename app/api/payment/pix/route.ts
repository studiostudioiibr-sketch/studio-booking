import { NextRequest, NextResponse } from 'next/server'
import { getReservationById } from '@/lib/google-sheets'
import { createPixCharge } from '@/lib/pagbank'
import { z } from 'zod'

const schema = z.object({
  reservation_id: z.string().uuid(),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = schema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: 'reservation_id inválido' }, { status: 400 })
    }

    const { reservation_id } = parsed.data

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
    return NextResponse.json({ error: 'Erro ao gerar PIX' }, { status: 500 })
  }
}
