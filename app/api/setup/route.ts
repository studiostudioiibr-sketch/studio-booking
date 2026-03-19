import { NextRequest, NextResponse } from 'next/server'
import { ensureSheetHeader } from '@/lib/google-sheets'

// GET /api/setup — run once to create the spreadsheet header row
// Protect with a secret token in production
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (token !== process.env.SETUP_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    await ensureSheetHeader()
    return NextResponse.json({ ok: true, message: 'Sheet header created successfully.' })
  } catch (err) {
    console.error('[GET /api/setup]', err)
    return NextResponse.json({ error: 'Failed to setup sheet' }, { status: 500 })
  }
}
