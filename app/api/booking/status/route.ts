import { NextRequest, NextResponse } from 'next/server'
import { getReservationById } from '@/lib/google-sheets'
import { z } from 'zod'

const schema = z.object({ id: z.string().uuid() })

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const parsed = schema.safeParse({ id: searchParams.get('id') })

    if (!parsed.success) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
    }

    const result = await getReservationById(parsed.data.id)
    if (!result) {
      return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })
    }

    const { reservation } = result
    const now = new Date()

    // Apply lazy expiration
    const effectiveStatus =
      reservation.status === 'HOLD' && new Date(reservation.expires_at) <= now
        ? 'EXPIRADO'
        : reservation.status

    return NextResponse.json({
      status: effectiveStatus,
      expires_at: reservation.expires_at,
    })
  } catch (err) {
    console.error('[GET /api/booking/status]', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
