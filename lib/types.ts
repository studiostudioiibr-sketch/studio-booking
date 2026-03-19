// ─── Reservation States ───────────────────────────────────────────────────────

export type ReservationStatus = 'HOLD' | 'CONFIRMADO' | 'EXPIRADO' | 'CANCELADO'

export interface Reservation {
  id: string
  slot_datetime: string        // ISO: "2024-03-15T14:30:00-03:00"
  status: ReservationStatus
  expires_at: string           // ISO — preenchido só em HOLD
  cliente_nome: string
  cliente_email: string
  cliente_telefone: string
  addons: string               // JSON string: ["makeup","stylist"]
  total_cents: number
  gateway: 'pagbank' | ''
  gateway_tx_id: string        // ID da transação no gateway
  created_at: string           // ISO
  confirmed_at: string         // ISO — preenchido quando CONFIRMADO
}

// ─── Slots ────────────────────────────────────────────────────────────────────

export interface Slot {
  datetime: string             // ISO
  label: string                // "09:00" — para exibir
  available: boolean
  hold_expires_at?: string     // se em HOLD, quando expira (para UI mostrar)
}

// ─── Booking Request ──────────────────────────────────────────────────────────

export interface CreateBookingRequest {
  slot_datetime: string
  cliente_nome: string
  cliente_email: string
  cliente_telefone: string
  addons: ('makeup' | 'stylist')[]
}

export interface CreateBookingResponse {
  reservation_id: string
  expires_at: string
  total_cents: number
}

// ─── Payment ──────────────────────────────────────────────────────────────────

export interface CreatePaymentRequest {
  reservation_id: string
  gateway: 'pagbank'
  // Cartão (só para pagbank)
  card?: {
    number: string
    holder: string
    expiry_month: string
    expiry_year: string
    cvv: string
  }
}

export interface PixPaymentResponse {
  qr_code_text: string
  qr_code_image_url: string
  expires_at: string
}

export interface CardPaymentResponse {
  status: 'APROVADO' | 'RECUSADO' | 'PENDENTE'
  message: string
}

// ─── Addons ───────────────────────────────────────────────────────────────────

export const ADDONS = {
  makeup: {
    label: 'Maquiador',
    price_cents: Number(process.env.ADDON_MAKEUP_CENTS ?? 16000),
    note: 'Chegar com 30 min de antecedência',
  },
  stylist: {
    label: 'Figurinista',
    price_cents: Number(process.env.ADDON_STYLIST_CENTS ?? 30000),
    note: null,
  },
} as const

export type AddonKey = keyof typeof ADDONS
