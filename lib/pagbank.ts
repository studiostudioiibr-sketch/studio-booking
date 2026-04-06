import { CardPaymentResponse } from './types'
import { digitsOnlyTaxId, isValidBrazilTaxIdDigits } from './brazilian-tax-id'

const PAGBANK_BASE = process.env.PAGBANK_ENV === 'production'
  ? 'https://api.pagseguro.com'
  : 'https://sandbox.api.pagseguro.com'

function pagbankNotificationUrls(): string[] | undefined {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '')
  if (!base) return undefined
  return [`${base}/api/webhook/pagbank`]
}

// ─── Create card charge (cartão criptografado no browser — SDK PagSeguro) ─────

export async function createCardCharge(params: {
  reservation_id: string
  total_cents: number
  cliente_nome: string
  cliente_email: string
  /** CPF/CNPJ do comprador — obrigatório (`customer.tax_id`) */
  customer_tax_id: string
  /** Payload RSA gerado por PagSeguro.encryptCard().encryptedCard */
  encrypted: string
  /** Nome impresso no cartão (deve bater com o usado na criptografia) */
  holder_name: string
  /** CPF/CNPJ do portador em `payment_method.holder`; se inválido, usa customer_tax_id */
  holder_tax_id?: string
  installments?: number
}): Promise<CardPaymentResponse & { transaction_id: string }> {
  const customerTax = digitsOnlyTaxId(params.customer_tax_id)
  if (!isValidBrazilTaxIdDigits(customerTax)) {
    throw new Error('CPF ou CNPJ do comprador inválido')
  }
  const holderTaxRaw = params.holder_tax_id ? digitsOnlyTaxId(params.holder_tax_id) : customerTax
  const holderTax = isValidBrazilTaxIdDigits(holderTaxRaw) ? holderTaxRaw : customerTax
  const notify = pagbankNotificationUrls()
  const body = {
    reference_id: params.reservation_id,
    customer: {
      name: params.cliente_nome,
      email: params.cliente_email,
      tax_id: customerTax,
    },
    items: [
      {
        name: 'Sessão Fotográfica Studio II',
        quantity: 1,
        unit_amount: params.total_cents,
      },
    ],
    ...(notify?.length ? { notification_urls: notify } : {}),
    charges: [
      {
        reference_id: params.reservation_id,
        description: 'Sessão Studio II',
        amount: {
          value: params.total_cents,
          currency: 'BRL',
        },
        payment_method: {
          type: 'CREDIT_CARD',
          installments: params.installments ?? 1,
          capture: true,
          card: {
            encrypted: params.encrypted,
            store: false,
          },
          holder: {
            name: params.holder_name,
            tax_id: holderTax,
          },
        },
      },
    ],
  }

  const res = await fetch(`${PAGBANK_BASE}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.PAGBANK_TOKEN}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`PagBank error ${res.status}: ${err}`)
  }

  const data = await res.json()
  const charge = data.charges?.[0]
  const paymentResponse = charge?.payment_response

  const code = String(paymentResponse?.code ?? '')
  const approved =
    charge?.status === 'PAID' ||
    code === '10000' ||
    code === '20000'

  return {
    transaction_id: data.id ?? '',
    status: approved ? 'APROVADO' : charge?.status === 'DECLINED' ? 'RECUSADO' : 'PENDENTE',
    message: paymentResponse?.message ?? 'Processando',
  }
}

// ─── Create PIX charge ────────────────────────────────────────────────────────

export async function createPixCharge(params: {
  reservation_id: string
  total_cents: number
  cliente_nome: string
  cliente_email: string
  /** CPF/CNPJ do pagador — obrigatório (`customer.tax_id`) */
  customer_tax_id: string
  expires_in_minutes?: number
}): Promise<{
  transaction_id: string
  qr_code_text: string
  qr_code_image_url: string
  expires_at: string
}> {
  const expiresInMinutes = Math.max(1, params.expires_in_minutes ?? 15)
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000).toISOString()
  const notify = pagbankNotificationUrls()
  const customerTax = digitsOnlyTaxId(params.customer_tax_id)
  if (!isValidBrazilTaxIdDigits(customerTax)) {
    throw new Error('CPF ou CNPJ do pagador inválido')
  }

  const body = {
    reference_id: params.reservation_id,
    customer: {
      name: params.cliente_nome,
      email: params.cliente_email,
      tax_id: customerTax,
    },
    items: [
      {
        name: 'Sessao Fotografica Studio II',
        quantity: 1,
        unit_amount: params.total_cents,
      },
    ],
    ...(notify?.length ? { notification_urls: notify } : {}),
    charges: [
      {
        reference_id: params.reservation_id,
        description: 'Sessao Studio II',
        amount: {
          value: params.total_cents,
          currency: 'BRL',
        },
        payment_method: {
          type: 'PIX',
          expires_at: expiresAt,
        },
      },
    ],
  }

  const res = await fetch(`${PAGBANK_BASE}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.PAGBANK_TOKEN}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`PagBank PIX error ${res.status}: ${err}`)
  }

  const data = await res.json()

  // 1) QR no nível do pedido (ex.: doc "Criar Pedido - QR Code - PIX")
  const orderQr = Array.isArray(data.qr_codes) ? data.qr_codes[0] : null
  let qr_code_text = ''
  let qr_code_image_url = ''
  let expiresOut = expiresAt

  if (orderQr) {
    qr_code_text =
      orderQr.text ??
      orderQr.emv ??
      orderQr.payload ??
      ''
    const oLinks = orderQr.links ?? []
    qr_code_image_url =
      oLinks.find((l: any) => l?.rel === 'QRCODE.PNG')?.href ??
      oLinks.find((l: any) => l?.media?.toLowerCase?.().includes('image/png'))?.href ??
      ''
    if (orderQr.expiration_date) expiresOut = orderQr.expiration_date
  }

  // 2) QR dentro da cobrança PIX
  if (!qr_code_text) {
    const charge = data?.charges?.[0] ?? {}
    const paymentMethod = charge?.payment_method ?? {}
    const pix = paymentMethod?.pix ?? {}
    const qrCodes = pix?.qr_codes ?? charge?.qr_codes ?? []
    const qrCode = qrCodes?.[0] ?? {}
    const links = [
      ...(pix?.links ?? []),
      ...(qrCode?.links ?? []),
      ...(charge?.links ?? []),
    ]

    qr_code_text =
      qrCode?.text ??
      qrCode?.emv ??
      pix?.emv ??
      pix?.payload ??
      ''

    qr_code_image_url =
      links.find((l: any) => l?.rel === 'QRCODE.PNG')?.href ??
      links.find((l: any) => l?.media?.toLowerCase?.().includes('image/png'))?.href ??
      ''

    if (qrCode?.expiration_date ?? pix?.expiration_date) {
      expiresOut = qrCode?.expiration_date ?? pix?.expiration_date ?? expiresOut
    }
  }

  if (!qr_code_text) {
    throw new Error(
      `PagBank PIX: resposta sem código PIX. Snippet: ${JSON.stringify(data).slice(0, 400)}`
    )
  }

  return {
    transaction_id: data?.id ?? '',
    qr_code_text,
    qr_code_image_url,
    expires_at: expiresOut,
  }
}

// ─── Verify PagBank webhook ───────────────────────────────────────────────────

export interface PagBankWebhookEvent {
  event: string
  order: {
    id: string
    reference_id: string   // our reservation_id
    status: string
    paid_at?: string
    qr_codes?: Array<{
      text?: string
      expiration_date?: string
    }>
    charges: Array<{
      id: string
      status: string
      paid_at?: string
      payment_method?: {
        type?: string
      }
    }>
  }
}

export function isPagBankPaymentConfirmed(event: PagBankWebhookEvent): boolean {
  return event?.order?.status === 'PAID' ||
    event?.order?.charges?.some(c => c.status === 'PAID') === true
}

// Backwards compatibility while routes are migrated.
export const isCardPaymentConfirmed = isPagBankPaymentConfirmed
