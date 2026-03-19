'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(cents: number) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

interface BookingSession {
  reservation_id: string
  expires_at: string
  total_cents: number
  slot_label: string
  cliente_nome: string
  cliente_email: string
  addons: string[]
}

const ADDON_LABELS: Record<string, string> = {
  makeup: 'Maquiador',
  stylist: 'Figurinista',
}

function buildVoucherText(b: BookingSession): string {
  const addonLine =
    b.addons?.length > 0
      ? b.addons.map(k => ADDON_LABELS[k] ?? k).join(', ')
      : 'Nenhum'
  return [
    'Studio II — Comprovante de reserva',
    `ID: ${b.reservation_id}`,
    `Nome: ${b.cliente_nome}`,
    `E-mail: ${b.cliente_email}`,
    `Data e horário: ${b.slot_label}`,
    'Endereço: Rua Miranda Valverde, 123 — Botafogo, Rio de Janeiro',
    `Total: ${formatCurrency(b.total_cents)}`,
    `Adicionais: ${addonLine}`,
    '',
    'Guarde este comprovante (captura de tela, cópia ou salvar como PDF ao imprimir).',
    'Dúvidas: WhatsApp (21) 95902-3665 · @studioiibr',
  ].join('\n')
}

// ─── Timer Hook ───────────────────────────────────────────────────────────────

function useCountdown(expiresAt: string | null) {
  const [seconds, setSeconds] = useState<number>(0)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (!expiresAt) return

    const update = () => {
      const diff = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000))
      setSeconds(diff)
      if (diff === 0 && intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }

    update()
    intervalRef.current = setInterval(update, 1000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [expiresAt])

  return seconds
}

// ─── PIX Panel ────────────────────────────────────────────────────────────────

function PixPanel({ reservationId, totalCents }: { reservationId: string; totalCents: number }) {
  const [loading, setLoading] = useState(true)
  const [pix, setPix] = useState<{ qr_code_text: string; qr_code_image_url: string } | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetch('/api/payment/pix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reservation_id: reservationId }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error)
        setPix(data)
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [reservationId])

  const copy = useCallback(async () => {
    if (!pix?.qr_code_text) return
    await navigator.clipboard.writeText(pix.qr_code_text)
    setCopied(true)
    setTimeout(() => setCopied(false), 3000)
  }, [pix])

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-4 py-10">
        <div className="w-40 h-40 bg-ink/5 animate-pulse" />
        <p className="text-sm text-muted font-body">Gerando QR Code...</p>
      </div>
    )
  }

  if (error) {
    return <p className="text-red-500 text-sm font-body p-4 bg-red-50 border border-red-100">{error}</p>
  }

  return (
    <div className="flex flex-col items-center gap-6 py-6">
      {/* QR Code */}
      {pix?.qr_code_image_url ? (
        <img
          src={pix.qr_code_image_url}
          alt="QR Code PIX"
          className="w-48 h-48 border border-ink/10"
        />
      ) : (
        <div className="w-48 h-48 bg-ink/5 flex items-center justify-center text-muted text-xs">
          QR indisponível
        </div>
      )}

      <p className="text-sm text-muted font-body text-center max-w-xs">
        Abra o app do seu banco, escaneie o QR Code ou copie o código abaixo
      </p>

      <button
        onClick={copy}
        className={`
          w-full border py-3.5 font-body text-sm font-medium tracking-widest uppercase transition-all
          ${copied ? 'border-accent text-accent bg-accent/5' : 'border-ink/20 text-ink hover:border-ink'}
        `}
      >
        {copied ? '✓ Código copiado!' : 'Copiar código PIX'}
      </button>

      <p className="text-xs text-muted/50 font-body text-center">
        Total: <strong className="text-muted">{formatCurrency(totalCents)}</strong>
        &nbsp;·&nbsp;O pagamento é confirmado automaticamente
      </p>
    </div>
  )
}

// ─── Card Panel ───────────────────────────────────────────────────────────────

function CardPanel({
  reservationId,
  totalCents,
  onSuccess,
}: {
  reservationId: string
  totalCents: number
  onSuccess: () => void
}) {
  const [card, setCard] = useState({
    number: '',
    holder: '',
    expiry: '',
    cvv: '',
    installments: '1',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const formatCardNumber = (val: string) =>
    val.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim()

  const formatExpiry = (val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, 6)
    return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits
  }

  const handleSubmit = async () => {
    setError('')
    setLoading(true)

    const [expiry_month, expiry_year] = card.expiry.split('/')
    const cardNumber = card.number.replace(/\s/g, '')

    if (cardNumber.length < 13 || !expiry_month || expiry_year?.length < 4 || !card.cvv || !card.holder) {
      setError('Preencha todos os dados do cartão corretamente.')
      setLoading(false)
      return
    }

    try {
      const res = await fetch('/api/payment/card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reservation_id: reservationId,
          card: {
            number: cardNumber,
            holder: card.holder,
            expiry_month,
            expiry_year: `20${expiry_year}`,
            cvv: card.cvv,
          },
          installments: Number(card.installments),
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Pagamento recusado.')
        return
      }

      onSuccess()
    } catch {
      setError('Erro de conexão. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4 py-4">
      {/* Card number */}
      <div>
        <label className="block text-[10px] font-body font-medium tracking-widest uppercase text-muted mb-1.5">
          Número do cartão
        </label>
        <input
          type="text"
          inputMode="numeric"
          placeholder="0000 0000 0000 0000"
          value={card.number}
          onChange={e => setCard(p => ({ ...p, number: formatCardNumber(e.target.value) }))}
          className="w-full border-b border-ink/20 bg-transparent py-2.5 font-body text-base text-ink placeholder:text-ink/20 focus:outline-none focus:border-ink transition-colors"
        />
      </div>

      {/* Holder */}
      <div>
        <label className="block text-[10px] font-body font-medium tracking-widest uppercase text-muted mb-1.5">
          Nome no cartão
        </label>
        <input
          type="text"
          placeholder="MARIA SILVA"
          value={card.holder}
          onChange={e => setCard(p => ({ ...p, holder: e.target.value.toUpperCase() }))}
          className="w-full border-b border-ink/20 bg-transparent py-2.5 font-body text-base text-ink placeholder:text-ink/20 focus:outline-none focus:border-ink transition-colors"
        />
      </div>

      {/* Expiry + CVV */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-[10px] font-body font-medium tracking-widest uppercase text-muted mb-1.5">
            Validade
          </label>
          <input
            type="text"
            inputMode="numeric"
            placeholder="MM/AAAA"
            value={card.expiry}
            onChange={e => setCard(p => ({ ...p, expiry: formatExpiry(e.target.value) }))}
            className="w-full border-b border-ink/20 bg-transparent py-2.5 font-body text-base text-ink placeholder:text-ink/20 focus:outline-none focus:border-ink transition-colors"
          />
        </div>
        <div>
          <label className="block text-[10px] font-body font-medium tracking-widest uppercase text-muted mb-1.5">
            CVV
          </label>
          <input
            type="text"
            inputMode="numeric"
            placeholder="123"
            maxLength={4}
            value={card.cvv}
            onChange={e => setCard(p => ({ ...p, cvv: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
            className="w-full border-b border-ink/20 bg-transparent py-2.5 font-body text-base text-ink placeholder:text-ink/20 focus:outline-none focus:border-ink transition-colors"
          />
        </div>
      </div>

      {/* Installments */}
      <div>
        <label className="block text-[10px] font-body font-medium tracking-widest uppercase text-muted mb-1.5">
          Parcelas
        </label>
        <select
          value={card.installments}
          onChange={e => setCard(p => ({ ...p, installments: e.target.value }))}
          className="w-full border-b border-ink/20 bg-transparent py-2.5 font-body text-base text-ink focus:outline-none focus:border-ink transition-colors cursor-pointer"
        >
          <option value="1">1× de {formatCurrency(totalCents)} (à vista)</option>
          <option value="2">2× de {formatCurrency(Math.ceil(totalCents / 2))} sem juros</option>
        </select>
      </div>

      {error && (
        <p className="text-red-500 text-sm font-body p-3 bg-red-50 border border-red-100">{error}</p>
      )}

      <button
        onClick={handleSubmit}
        disabled={loading}
        className="w-full bg-ink text-paper py-4 font-body text-sm font-medium tracking-widest uppercase hover:bg-ink/90 active:scale-[0.99] transition-all mt-4 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? 'Processando...' : `Pagar ${formatCurrency(totalCents)}`}
      </button>
    </div>
  )
}

// ─── Checkout Page ─────────────────────────────────────────────────────────────

export default function CheckoutPage() {
  const router = useRouter()
  const [booking, setBooking] = useState<BookingSession | null>(null)
  const [gateway, setGateway] = useState<'pix' | 'card'>('pix')
  const [confirmed, setConfirmed] = useState(false)
  const [voucherCopied, setVoucherCopied] = useState(false)

  const secondsLeft = useCountdown(booking?.expires_at ?? null)
  const isExpired = secondsLeft === 0 && booking !== null

  // Load booking from sessionStorage
  useEffect(() => {
    const raw = sessionStorage.getItem('booking')
    if (!raw) {
      router.replace('/')
      return
    }
    try {
      setBooking(JSON.parse(raw))
    } catch {
      router.replace('/')
    }
  }, [router])

  // Poll for PIX confirmation
  useEffect(() => {
    if (gateway !== 'pix' || !booking || confirmed) return

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/booking/status?id=${booking.reservation_id}`)
        const data = await res.json()
        if (data.status === 'CONFIRMADO') {
          setConfirmed(true)
          clearInterval(interval)
        }
      } catch {
        // silently retry
      }
    }, 3000)

    return () => clearInterval(interval)
  }, [gateway, booking, confirmed])

  if (!booking) return null

  // ── Confirmed screen ────────────────────────────────────────────────────────
  if (confirmed) {
    const handleCopyVoucher = async () => {
      try {
        await navigator.clipboard.writeText(buildVoucherText(booking))
        setVoucherCopied(true)
        setTimeout(() => setVoucherCopied(false), 3000)
      } catch {
        // ignore
      }
    }

    return (
      <div className="min-h-screen bg-paper flex flex-col items-center justify-center px-6 py-12 text-center">
        <div className="max-w-md w-full mx-auto animate-fade-up">
          <div className="w-16 h-16 bg-ink flex items-center justify-center mx-auto mb-6">
            <span className="text-paper text-2xl">✓</span>
          </div>
          <h1 className="font-display text-4xl mb-3">
            Sessão<br /><em>confirmada.</em>
          </h1>
          <p className="font-body text-sm text-muted mb-6 max-w-sm mx-auto">
            Guarde o comprovante abaixo: copie o texto, tire um print ou use <strong className="text-ink font-medium">Imprimir</strong> e salve em PDF no celular ou computador.
          </p>

          <div className="border border-ink/10 p-6 text-left mb-6 bg-paper print:border-ink print:shadow-none">
            <p className="text-xs font-body tracking-widest uppercase text-muted mb-4">Comprovante</p>
            <dl className="space-y-3 font-body text-sm text-ink">
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-muted">Nome</dt>
                <dd>{booking.cliente_nome}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-muted">E-mail</dt>
                <dd className="break-all">{booking.cliente_email}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-muted">Data e horário</dt>
                <dd>{booking.slot_label}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-muted">Local</dt>
                <dd>Rua Miranda Valverde, 123 — Botafogo, Rio de Janeiro</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-muted">Total</dt>
                <dd className="font-medium">{formatCurrency(booking.total_cents)}</dd>
              </div>
              {booking.addons?.length > 0 && (
                <div>
                  <dt className="text-[10px] uppercase tracking-widest text-muted">Adicionais</dt>
                  <dd>{booking.addons.map(k => ADDON_LABELS[k] ?? k).join(', ')}</dd>
                </div>
              )}
              {booking.addons?.includes('makeup') && (
                <p className="text-xs text-accent border-l-2 border-accent pl-3 py-1">
                  Com maquiador: chegue com <strong>30 minutos de antecedência</strong>.
                </p>
              )}
              <div className="pt-2 border-t border-ink/10">
                <dt className="text-[10px] uppercase tracking-widest text-muted">ID da reserva</dt>
                <dd className="font-mono text-xs break-all text-muted">{booking.reservation_id}</dd>
              </div>
            </dl>
          </div>

          <div className="no-print flex flex-col gap-3 max-w-md mx-auto">
            <button
              type="button"
              onClick={handleCopyVoucher}
              className={`
                w-full border py-3.5 font-body text-sm font-medium tracking-widest uppercase transition-all
                ${voucherCopied ? 'border-accent text-accent bg-accent/5' : 'border-ink/20 text-ink hover:border-ink'}
              `}
            >
              {voucherCopied ? '✓ Comprovante copiado!' : 'Copiar comprovante (texto)'}
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="w-full bg-ink text-paper py-3.5 font-body text-sm font-medium tracking-widest uppercase hover:bg-ink/90 transition-all"
            >
              Imprimir / salvar PDF
            </button>
            <a
              href="/"
              className="text-xs font-body tracking-widest uppercase text-muted hover:text-ink transition-colors py-2"
            >
              ← Voltar ao início
            </a>
          </div>
        </div>
      </div>
    )
  }

  // ── Expired screen ──────────────────────────────────────────────────────────
  if (isExpired) {
    return (
      <div className="min-h-screen bg-paper flex flex-col items-center justify-center px-6 text-center">
        <div className="max-w-sm mx-auto animate-fade-up">
          <div className="w-16 h-16 border border-ink/20 flex items-center justify-center mx-auto mb-8">
            <span className="text-2xl">⏰</span>
          </div>
          <h1 className="font-display text-4xl mb-4">Tempo<br />esgotado.</h1>
          <p className="font-body text-muted mb-8">
            Sua pré-reserva expirou. O horário foi liberado para outros.
          </p>
          <a
            href="/"
            className="inline-block bg-ink text-paper px-8 py-4 font-body text-sm font-medium tracking-widest uppercase hover:bg-ink/90 transition-all"
          >
            Tentar novamente
          </a>
        </div>
      </div>
    )
  }

  // ── Main checkout ───────────────────────────────────────────────────────────
  const timerUrgent = secondsLeft <= 120 // last 2 minutes

  return (
    <div className="min-h-screen bg-paper grain">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 px-6 py-5 flex justify-between items-center bg-paper/90 backdrop-blur-sm border-b border-ink/5">
        <a href="/" className="font-display text-xl tracking-tight">Studio II</a>

        {/* Timer */}
        <div className={`flex items-center gap-2 ${timerUrgent ? 'animate-pulse-timer' : ''}`}>
          <span className={`text-xs font-body tracking-widest uppercase ${timerUrgent ? 'text-red-500' : 'text-muted'}`}>
            Reservado por
          </span>
          <span className={`font-body font-semibold text-sm tabular-nums ${timerUrgent ? 'text-red-500' : 'text-ink'}`}>
            {formatTime(secondsLeft)}
          </span>
        </div>
      </header>

      <main className="pt-28 pb-32 px-6 max-w-lg mx-auto">

        {/* Booking summary */}
        <section className="mb-10 animate-fade-up">
          <p className="text-xs font-body tracking-widest uppercase text-muted mb-5">Resumo</p>
          <div className="border border-ink/10 p-5">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h2 className="font-display text-xl leading-tight">Sessão Fotográfica</h2>
                <p className="text-sm font-body text-muted mt-0.5">{booking.slot_label}</p>
              </div>
              <span className="font-display text-xl">{formatCurrency(booking.total_cents)}</span>
            </div>
            <div className="border-t border-ink/5 pt-3">
              <p className="text-xs font-body text-muted">Rua Miranda Valverde, 123 — Botafogo, Rio de Janeiro</p>
              {booking.addons?.length > 0 && (
                <p className="text-xs font-body text-accent mt-1">
                  + {booking.addons.join(', ')}
                </p>
              )}
            </div>
          </div>
        </section>

        {/* Payment method toggle */}
        <section className="mb-8 animate-fade-up" style={{ animationDelay: '80ms' }}>
          <p className="text-xs font-body tracking-widest uppercase text-muted mb-4">
            Forma de pagamento
          </p>
          <div className="grid grid-cols-2 gap-2">
            {([
              { key: 'pix', label: 'PIX', sub: 'Aprovação imediata' },
              { key: 'card', label: 'Cartão', sub: 'Até 2× sem juros' },
            ] as const).map(opt => (
              <button
                key={opt.key}
                onClick={() => setGateway(opt.key)}
                className={`
                  p-4 border text-left transition-all duration-200
                  ${gateway === opt.key ? 'border-ink bg-ink text-paper' : 'border-ink/15 hover:border-ink/40'}
                `}
              >
                <p className={`font-body font-medium text-sm uppercase tracking-wide ${gateway === opt.key ? 'text-paper' : 'text-ink'}`}>
                  {opt.label}
                </p>
                <p className={`text-xs mt-0.5 ${gateway === opt.key ? 'text-paper/60' : 'text-muted'}`}>
                  {opt.sub}
                </p>
              </button>
            ))}
          </div>
        </section>

        {/* Payment panel */}
        <section className="animate-fade-up" style={{ animationDelay: '160ms' }}>
          {gateway === 'pix' ? (
            <PixPanel
              reservationId={booking.reservation_id}
              totalCents={booking.total_cents}
            />
          ) : (
            <CardPanel
              reservationId={booking.reservation_id}
              totalCents={booking.total_cents}
              onSuccess={() => setConfirmed(true)}
            />
          )}
        </section>
      </main>
    </div>
  )
}
