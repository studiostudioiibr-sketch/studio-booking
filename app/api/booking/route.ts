import { NextRequest, NextResponse } from 'next/server'
import { createHoldReservation } from '@/lib/google-sheets'
import { ADDONS, AddonKey } from '@/lib/types'
import { z } from 'zod'

const schema = z.object({
  slot_datetime: z.string().min(1),
  cliente_nome: z.string().min(2),
  cliente_email: z.string().email(),
  cliente_telefone: z.string().min(8),
  addons: z.array(z.enum(['makeup', 'stylist'])).default([]),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = schema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { slot_datetime, cliente_nome, cliente_email, cliente_telefone, addons } = parsed.data

    // Calculate total
    const basePrice = Number(process.env.BASE_PRICE_CENTS ?? 20000)
    const addonsTotal = addons.reduce((sum, key) => sum + ADDONS[key as AddonKey].price_cents, 0)
    const total_cents = basePrice + addonsTotal

    // Create HOLD (includes optimistic lock check)
    const result = await createHoldReservation({
      slot_datetime,
      cliente_nome,
      cliente_email,
      cliente_telefone,
      addons,
      total_cents,
    })

    if ('error' in result) {
      return NextResponse.json(
        { error: 'Esse horário acabou de ser reservado. Por favor, escolha outro.' },
        { status: 409 }
      )
    }

    return NextResponse.json({
      reservation_id: result.id,
      expires_at: result.expires_at,
      total_cents: result.total_cents,
    })
  } catch (err) {
    console.error('[POST /api/booking]', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
