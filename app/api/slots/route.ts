import { NextRequest, NextResponse } from 'next/server'
import { getSlotsForDate } from '@/lib/google-calendar'
import { z } from 'zod'

const schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use format YYYY-MM-DD'),
})

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const parsed = schema.safeParse({ date: searchParams.get('date') })

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
    }

    const slots = await getSlotsForDate(parsed.data.date)
    return NextResponse.json({ slots })
  } catch (err) {
    console.error('[GET /api/slots]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
