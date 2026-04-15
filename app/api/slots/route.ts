import { NextRequest, NextResponse } from 'next/server'
import { getMonthAvailabilityByDate, getSlotsForDate } from '@/lib/google-calendar'
import { formatGoogleIntegrationError } from '@/lib/google-api-error'
import { z } from 'zod'

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use format YYYY-MM-DD')
const monthSchema = z.string().regex(/^\d{4}-\d{2}$/, 'Use format YYYY-MM')

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const dateParam = searchParams.get('date')
    const monthParam = searchParams.get('month')

    if (dateParam) {
      const parsedDate = dateSchema.safeParse(dateParam)
      if (!parsedDate.success) {
        return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
      }

      const slots = await getSlotsForDate(parsedDate.data)
      return NextResponse.json({ slots })
    }

    if (monthParam) {
      const parsedMonth = monthSchema.safeParse(monthParam)
      if (!parsedMonth.success) {
        return NextResponse.json({ error: 'Invalid month' }, { status: 400 })
      }

      const availabilityByDate = await getMonthAvailabilityByDate(parsedMonth.data)
      return NextResponse.json({ month: parsedMonth.data, availabilityByDate })
    }

    return NextResponse.json(
      { error: 'Missing required query parameter: date or month' },
      { status: 400 }
    )
  } catch (err) {
    console.error('[GET /api/slots]', err)
    const message = formatGoogleIntegrationError(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
