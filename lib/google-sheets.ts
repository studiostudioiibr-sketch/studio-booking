import { google } from 'googleapis'
import { Reservation, ReservationStatus } from './types'
import { v4 as uuidv4 } from 'uuid'

// ─── Auth ─────────────────────────────────────────────────────────────────────

function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!)
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
}

function getSheets() {
  return google.sheets({ version: 'v4', auth: getAuth() })
}

const SHEET_ID = process.env.GOOGLE_SHEET_ID!
const TAB = 'reservas'

// ─── Row mapping ──────────────────────────────────────────────────────────────
// Columns: A=id B=slot_datetime C=status D=expires_at E=cliente_nome
//          F=cliente_email G=cliente_telefone H=addons I=total_cents
//          J=gateway K=gateway_tx_id L=created_at M=confirmed_at

function rowToReservation(row: string[]): Reservation {
  return {
    id: row[0] ?? '',
    slot_datetime: row[1] ?? '',
    status: (row[2] as ReservationStatus) ?? 'HOLD',
    expires_at: row[3] ?? '',
    cliente_nome: row[4] ?? '',
    cliente_email: row[5] ?? '',
    cliente_telefone: row[6] ?? '',
    addons: row[7] ?? '[]',
    total_cents: Number(row[8] ?? 0),
    gateway: (row[9] as Reservation['gateway']) ?? '',
    gateway_tx_id: row[10] ?? '',
    created_at: row[11] ?? '',
    confirmed_at: row[12] ?? '',
  }
}

function reservationToRow(r: Reservation): string[] {
  return [
    r.id,
    r.slot_datetime,
    r.status,
    r.expires_at,
    r.cliente_nome,
    r.cliente_email,
    r.cliente_telefone,
    r.addons,
    String(r.total_cents),
    r.gateway,
    r.gateway_tx_id,
    r.created_at,
    r.confirmed_at,
  ]
}

// ─── Read all reservations ────────────────────────────────────────────────────

export async function getAllReservations(): Promise<Reservation[]> {
  const sheets = getSheets()
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!A2:M`, // skip header row
  })
  const rows = res.data.values ?? []
  return rows.map(rowToReservation)
}

// ─── Get reservations for a specific date ────────────────────────────────────

export async function getReservationsByDate(date: string): Promise<Reservation[]> {
  const all = await getAllReservations()
  return all.filter(r => r.slot_datetime.startsWith(date))
}

// ─── Get single reservation by ID ────────────────────────────────────────────

export async function getReservationById(id: string): Promise<{ reservation: Reservation; rowIndex: number } | null> {
  const sheets = getSheets()
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!A2:M`,
  })
  const rows = res.data.values ?? []
  const idx = rows.findIndex(r => r[0] === id)
  if (idx === -1) return null
  return { reservation: rowToReservation(rows[idx]), rowIndex: idx + 2 } // +2: 1-indexed + header
}

// ─── Create a HOLD reservation ────────────────────────────────────────────────
// Uses optimistic lock: re-checks slot availability before inserting

export async function createHoldReservation(params: {
  slot_datetime: string
  cliente_nome: string
  cliente_email: string
  cliente_telefone: string
  addons: string[]
  total_cents: number
}): Promise<Reservation | { error: 'SLOT_TAKEN' }> {
  // 1. Re-check slot is still free (optimistic lock)
  const existing = await getAllReservations()
  const now = new Date()
  const conflict = existing.find(r => {
    if (r.slot_datetime !== params.slot_datetime) return false
    if (r.status === 'CONFIRMADO') return true
    if (r.status === 'HOLD' && new Date(r.expires_at) > now) return true
    return false
  })
  if (conflict) return { error: 'SLOT_TAKEN' }

  // 2. Build reservation
  const holdMinutes = Number(process.env.HOLD_TIMEOUT_MINUTES ?? 15)
  const expires_at = new Date(now.getTime() + holdMinutes * 60 * 1000).toISOString()
  const reservation: Reservation = {
    id: uuidv4(),
    slot_datetime: params.slot_datetime,
    status: 'HOLD',
    expires_at,
    cliente_nome: params.cliente_nome,
    cliente_email: params.cliente_email,
    cliente_telefone: params.cliente_telefone,
    addons: JSON.stringify(params.addons),
    total_cents: params.total_cents,
    gateway: '',
    gateway_tx_id: '',
    created_at: now.toISOString(),
    confirmed_at: '',
  }

  // 3. Append to sheet
  const sheets = getSheets()
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!A:M`,
    valueInputOption: 'RAW',
    requestBody: { values: [reservationToRow(reservation)] },
  })

  return reservation
}

// ─── Update reservation status ────────────────────────────────────────────────

export async function updateReservation(
  id: string,
  updates: Partial<Reservation>
): Promise<Reservation | null> {
  const result = await getReservationById(id)
  if (!result) return null

  const { reservation, rowIndex } = result
  const updated: Reservation = { ...reservation, ...updates }

  const sheets = getSheets()
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!A${rowIndex}:M${rowIndex}`,
    valueInputOption: 'RAW',
    requestBody: { values: [reservationToRow(updated)] },
  })

  return updated
}

// ─── Confirm reservation (called by webhook) ──────────────────────────────────

export async function confirmReservation(params: {
  reservation_id: string
  gateway: 'pagbank'
  gateway_tx_id: string
}): Promise<Reservation | null> {
  return updateReservation(params.reservation_id, {
    status: 'CONFIRMADO',
    gateway: params.gateway,
    gateway_tx_id: params.gateway_tx_id,
    confirmed_at: new Date().toISOString(),
    expires_at: '',
  })
}

// ─── Ensure header row exists ─────────────────────────────────────────────────
// Call this once when setting up the sheet

export async function ensureSheetHeader() {
  const sheets = getSheets()
  const header = [
    'id', 'slot_datetime', 'status', 'expires_at', 'cliente_nome',
    'cliente_email', 'cliente_telefone', 'addons', 'total_cents',
    'gateway', 'gateway_tx_id', 'created_at', 'confirmed_at',
  ]
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!A1:M1`,
    valueInputOption: 'RAW',
    requestBody: { values: [header] },
  })
}
