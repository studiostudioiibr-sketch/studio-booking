'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { format, addDays, startOfToday, isBefore, startOfDay } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { isValidBrazilTaxIdDigits } from '@/lib/brazilian-tax-id'
import { Slot, AddonKey, ADDONS } from '@/lib/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(cents: number) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

const BASE_PRICE = Number(process.env.NEXT_PUBLIC_BASE_PRICE_CENTS ?? 20000)

// ─── Calendar Component ────────────────────────────────────────────────────────

function MiniCalendar({
  selected,
  onSelect,
}: {
  selected: Date | null
  onSelect: (d: Date) => void
}) {
  const [viewMonth, setViewMonth] = useState(() => startOfToday())
  const today = startOfToday()

  // Build calendar grid for current view month
  const firstDay = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1)
  const startOffset = firstDay.getDay() // 0=Sun
  const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate()

  const cells: (Date | null)[] = [
    ...Array(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) =>
      new Date(viewMonth.getFullYear(), viewMonth.getMonth(), i + 1)
    ),
  ]

  const prevMonth = () =>
    setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))
  const nextMonth = () =>
    setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))

  return (
    <div>
      {/* Month header */}
      <div className="flex items-center justify-between mb-5">
        <button
          onClick={prevMonth}
          className="w-8 h-8 flex items-center justify-center text-ink/40 hover:text-ink transition-colors"
          aria-label="Mês anterior"
        >
          ←
        </button>
        <span className="font-body font-medium text-sm tracking-widest uppercase text-ink/60">
          {format(viewMonth, 'MMMM yyyy', { locale: ptBR })}
        </span>
        <button
          onClick={nextMonth}
          className="w-8 h-8 flex items-center justify-center text-ink/40 hover:text-ink transition-colors"
          aria-label="Próximo mês"
        >
          →
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 mb-2">
        {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d, i) => (
          <div key={i} className="text-center text-[10px] font-medium tracking-widest text-ink/30 uppercase py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-y-1">
        {cells.map((date, i) => {
          if (!date) return <div key={`empty-${i}`} />
          const isPast = isBefore(startOfDay(date), today)
          const isSelected = selected
            ? format(date, 'yyyy-MM-dd') === format(selected, 'yyyy-MM-dd')
            : false
          const isToday = format(date, 'yyyy-MM-dd') === format(today, 'yyyy-MM-dd')

          return (
            <button
              key={date.toISOString()}
              onClick={() => !isPast && onSelect(date)}
              disabled={isPast}
              className={`
                relative h-9 w-full flex items-center justify-center text-sm transition-all duration-150
                ${isPast ? 'text-ink/15 cursor-not-allowed' : 'hover:bg-ink/5 cursor-pointer'}
                ${isSelected ? 'bg-ink text-paper hover:bg-ink' : ''}
                ${isToday && !isSelected ? 'font-semibold text-accent' : ''}
              `}
            >
              {format(date, 'd')}
              {isToday && !isSelected && (
                <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-accent" />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type Step = 'date' | 'time' | 'info' | 'addons' | 'confirm'

export default function HomePage() {
  const router = useRouter()

  // Flow state
  const [step, setStep] = useState<Step>('date')
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [slots, setSlots] = useState<Slot[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [slotsError, setSlotsError] = useState('')
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null)
  const [addons, setAddons] = useState<AddonKey[]>([])
  const [form, setForm] = useState({ nome: '', email: '', telefone: '', cpf: '' })
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  // Total calculation
  const total = BASE_PRICE + addons.reduce((s, k) => s + ADDONS[k].price_cents, 0)

  // Load slots when date changes
  useEffect(() => {
    if (!selectedDate) return
    setSlotsLoading(true)
    setSlots([])
    setSlotsError('')
    setSelectedSlot(null)

    const dateStr = format(selectedDate, 'yyyy-MM-dd')
    fetch(`/api/slots?date=${dateStr}`)
      .then(async r => {
        const data = await r.json().catch(() => ({}))
        if (!r.ok) {
          setSlots([])
          setSlotsError(typeof data.error === 'string' ? data.error : 'Erro ao carregar horários.')
          setStep('time')
          return
        }
        setSlotsError('')
        setSlots(Array.isArray(data.slots) ? data.slots : [])
        setStep('time')
      })
      .catch(() => {
        setSlots([])
        setSlotsError('Erro de rede ao carregar horários. Tente novamente.')
        setStep('time')
      })
      .finally(() => setSlotsLoading(false))
  }, [selectedDate])

  const handleDateSelect = useCallback((date: Date) => {
    setSelectedDate(date)
  }, [])

  const handleSlotSelect = (slot: Slot) => {
    if (!slot.available) return
    setSelectedSlot(slot)
    setStep('info')
  }

  const toggleAddon = (key: AddonKey) => {
    setAddons(prev =>
      prev.includes(key) ? prev.filter(a => a !== key) : [...prev, key]
    )
  }

  const validateForm = () => {
    const errors: Record<string, string> = {}
    if (!form.nome.trim() || form.nome.trim().length < 2) errors.nome = 'Nome obrigatório'
    if (!form.email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) errors.email = 'E-mail inválido'
    if (!form.telefone.replace(/\D/g, '').match(/^\d{10,11}$/)) errors.telefone = 'Telefone inválido'
    const doc = form.cpf.replace(/\D/g, '')
    if (doc.length !== 11 && doc.length !== 14) {
      errors.cpf = 'CPF (11) ou CNPJ (14) dígitos obrigatório'
    } else if (!isValidBrazilTaxIdDigits(doc)) {
      errors.cpf = 'CPF ou CNPJ inválido. Confira os dígitos.'
    }
    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleConfirm = async () => {
    if (!validateForm()) return
    setStep('addons')
  }

  const handleSubmit = async () => {
    if (!selectedSlot) return
    setSubmitting(true)
    setSubmitError('')

    try {
      const res = await fetch('/api/booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slot_datetime: selectedSlot.datetime,
          cliente_nome: form.nome,
          cliente_email: form.email,
          cliente_telefone: form.telefone,
          addons,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setSubmitError(data.error ?? 'Erro ao criar reserva.')
        return
      }

      // Store in sessionStorage and redirect to checkout
      sessionStorage.setItem('booking', JSON.stringify({
        reservation_id: data.reservation_id,
        expires_at: data.expires_at,
        total_cents: data.total_cents,
        slot_label: format(new Date(selectedSlot.datetime), "EEEE, dd 'de' MMMM 'às' HH:mm", { locale: ptBR }),
        cliente_nome: form.nome,
        cliente_email: form.email,
        cliente_cpf: form.cpf.replace(/\D/g, ''),
        addons,
      }))

      router.push('/checkout')
    } catch {
      setSubmitError('Erro de conexão. Tente novamente.')
    } finally {
      setSubmitting(false)
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-paper grain">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 px-6 py-5 flex justify-between items-center">
        <span className="font-display text-xl tracking-tight">Studio II</span>
        <a
          href="https://wa.me/5521959023665"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center px-4 py-2 rounded-full text-[11px] font-body font-semibold tracking-widest uppercase bg-[#25D366] text-white hover:bg-[#20BA5A] active:scale-[0.98] transition-all shadow-sm"
        >
          WhatsApp
        </a>
      </header>

      {/* Hero */}
      <section className="pt-32 pb-16 px-6 max-w-lg mx-auto">
        <p className="text-xs font-body tracking-[0.3em] uppercase text-muted mb-4">
          Editorial Photography · Rio de Janeiro
        </p>
        <h1 className="font-display text-5xl leading-[1.05] mb-6">
          Reserve sua<br />
          <em>sessão.</em>
        </h1>
        <p className="font-body text-base text-muted leading-relaxed">
          Escolha uma data, selecione seu horário e finalize online.
          A pré-reserva é garantida por{' '}
          <span className="text-accent font-medium">
            {process.env.NEXT_PUBLIC_HOLD_TIMEOUT_MINUTES ?? '15'} minutos
          </span>{' '}
          após a seleção.
        </p>
      </section>

      {/* Step indicator */}
      <div className="px-6 max-w-lg mx-auto mb-10">
        <div className="flex gap-1">
          {(['date', 'time', 'info', 'addons', 'confirm'] as Step[]).map((s, i) => (
            <div
              key={s}
              className={`h-0.5 flex-1 transition-all duration-500 ${
                i <= (['date', 'time', 'info', 'addons', 'confirm'] as Step[]).indexOf(step)
                  ? 'bg-ink'
                  : 'bg-ink/10'
              }`}
            />
          ))}
        </div>
      </div>

      <main className="px-6 max-w-lg mx-auto pb-32">

        {/* ── Step: Date ── */}
        <section className="mb-12 animate-fade-up">
          <div className="flex items-center justify-between mb-6 border-b border-ink/10 pb-3">
            <h2 className="font-body text-xs tracking-widest uppercase text-muted">
              01 — Escolha a data
            </h2>
            {selectedDate && (
              <span className="text-xs font-body text-accent">
                {format(selectedDate, "dd/MM/yyyy")}
              </span>
            )}
          </div>
          <MiniCalendar selected={selectedDate} onSelect={handleDateSelect} />
        </section>

        {/* ── Step: Time ── */}
        {(step === 'time' || step === 'info' || step === 'addons' || step === 'confirm') && selectedDate && (
          <section className="mb-12 animate-fade-up">
            <div className="flex items-center justify-between mb-6 border-b border-ink/10 pb-3">
              <h2 className="font-body text-xs tracking-widest uppercase text-muted">
                02 — Escolha o horário
              </h2>
              {selectedSlot && (
                <span className="text-xs font-body text-accent">{selectedSlot.label}</span>
              )}
            </div>

            {slotsLoading ? (
              <div className="grid grid-cols-3 gap-2 stagger">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="h-12 bg-ink/5 animate-pulse" />
                ))}
              </div>
            ) : slots.length === 0 ? (
              <div className="space-y-2">
                {slotsError ? (
                  <div
                    role="alert"
                    className="text-sm font-body text-left p-4 border border-red-200 bg-red-50/80 text-red-900 leading-relaxed"
                  >
                    <p className="font-medium text-red-950 mb-1">Não foi possível carregar os horários</p>
                    <p>{slotsError}</p>
                  </div>
                ) : (
                  <p className="text-sm text-muted font-body">
                    Nenhum horário disponível para esta data. Tente outro dia.
                  </p>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2 stagger">
                {slots.map(slot => {
                  const isSelected = selectedSlot?.datetime === slot.datetime
                  const cls = !slot.available
                    ? slot.hold_expires_at ? 'slot-hold' : 'slot-unavailable'
                    : isSelected ? 'slot-selected' : 'slot-available'

                  return (
                    <button
                      key={slot.datetime}
                      onClick={() => handleSlotSelect(slot)}
                      disabled={!slot.available}
                      className={`h-12 text-sm font-body font-medium tracking-wide animate-fade-up ${cls}`}
                    >
                      {slot.label}
                      {slot.hold_expires_at && !slot.available && (
                        <span className="block text-[9px] tracking-widest uppercase opacity-70">hold</span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </section>
        )}

        {/* ── Step: Info ── */}
        {(step === 'info' || step === 'addons' || step === 'confirm') && (
          <section className="mb-12 animate-fade-up">
            <div className="flex items-center justify-between mb-6 border-b border-ink/10 pb-3">
              <h2 className="font-body text-xs tracking-widest uppercase text-muted">
                03 — Seus dados
              </h2>
            </div>

            <div className="space-y-4">
              {[
                { key: 'nome', label: 'Nome completo', type: 'text', placeholder: 'Maria Silva' },
                { key: 'email', label: 'E-mail', type: 'email', placeholder: 'maria@email.com' },
                { key: 'telefone', label: 'WhatsApp', type: 'tel', placeholder: '(21) 99999-0000' },
                { key: 'cpf', label: 'CPF ou CNPJ', type: 'text', placeholder: 'Somente números (11 ou 14 dígitos)' },
              ].map(field => (
                <div key={field.key}>
                  <label className="block text-[10px] font-body font-medium tracking-widest uppercase text-muted mb-1.5">
                    {field.label}
                  </label>
                  <input
                    type={field.type}
                    placeholder={field.placeholder}
                    value={form[field.key as keyof typeof form]}
                    onChange={e => {
                      const v =
                        field.key === 'cpf'
                          ? e.target.value.replace(/\D/g, '').slice(0, 14)
                          : e.target.value
                      setForm(prev => ({ ...prev, [field.key]: v }))
                    }}
                    className={`
                      w-full border-b bg-transparent py-2.5 font-body text-base text-ink placeholder:text-ink/20
                      focus:outline-none focus:border-ink transition-colors
                      ${formErrors[field.key] ? 'border-red-400' : 'border-ink/20'}
                    `}
                  />
                  {formErrors[field.key] && (
                    <p className="text-red-400 text-xs mt-1">{formErrors[field.key]}</p>
                  )}
                </div>
              ))}

              <button
                onClick={handleConfirm}
                className="w-full mt-4 bg-ink text-paper py-4 font-body text-sm font-medium tracking-widest uppercase hover:bg-ink/90 active:scale-[0.99] transition-all"
              >
                Continuar
              </button>
            </div>
          </section>
        )}

        {/* ── Step: Addons ── */}
        {(step === 'addons' || step === 'confirm') && (
          <section className="mb-12 animate-fade-up">
            <div className="flex items-center justify-between mb-6 border-b border-ink/10 pb-3">
              <h2 className="font-body text-xs tracking-widest uppercase text-muted">
                04 — Serviços adicionais
              </h2>
            </div>

            <div className="space-y-3 mb-8">
              {(Object.entries(ADDONS) as [AddonKey, typeof ADDONS[AddonKey]][]).map(([key, addon]) => {
                const selected = addons.includes(key)
                return (
                  <button
                    key={key}
                    onClick={() => toggleAddon(key)}
                    className={`
                      w-full flex items-start justify-between p-4 border text-left transition-all duration-200
                      ${selected ? 'border-ink bg-ink text-paper' : 'border-ink/15 hover:border-ink/40'}
                    `}
                  >
                    <div>
                      <p className={`font-body font-medium text-sm uppercase tracking-wide ${selected ? 'text-paper' : 'text-ink'}`}>
                        {addon.label}
                      </p>
                      {addon.note && (
                        <p className={`text-xs mt-0.5 ${selected ? 'text-paper/60' : 'text-muted'}`}>
                          {addon.note}
                        </p>
                      )}
                    </div>
                    <div className="text-right ml-4 shrink-0">
                      <p className={`font-body text-sm ${selected ? 'text-paper/80' : 'text-muted'}`}>
                        + {formatCurrency(addon.price_cents)}
                      </p>
                      <div className={`
                        mt-1 w-4 h-4 border ml-auto flex items-center justify-center transition-all
                        ${selected ? 'border-paper bg-paper' : 'border-ink/30'}
                      `}>
                        {selected && <span className="text-ink text-xs leading-none">✓</span>}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>

            {/* Summary */}
            <div className="border-t border-ink/10 pt-6 space-y-2 mb-6">
              <div className="flex justify-between text-sm font-body text-muted">
                <span>Sessão base</span>
                <span>{formatCurrency(BASE_PRICE)}</span>
              </div>
              {addons.map(key => (
                <div key={key} className="flex justify-between text-sm font-body text-muted">
                  <span>{ADDONS[key].label}</span>
                  <span>+ {formatCurrency(ADDONS[key].price_cents)}</span>
                </div>
              ))}
              <div className="flex justify-between font-display text-xl pt-3 border-t border-ink/10">
                <span>Total</span>
                <span>{formatCurrency(total)}</span>
              </div>
              <p className="text-xs text-muted font-body pt-1">
                PIX à vista · Cartão em até 2× sem juros
              </p>
              <p className="text-xs text-muted/80 font-body pt-3 leading-relaxed border-t border-ink/10 mt-3">
                O valor acima é da reserva da sessão. Depois dos cliques você escolhe quantas fotos quer
                levar — cada uma a partir R$ 80, podendo negociar direto no estúdio.
              </p>
            </div>

            {submitError && (
              <p className="text-red-500 text-sm font-body mb-4 p-3 bg-red-50 border border-red-100">
                {submitError}
              </p>
            )}

            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full bg-ink text-paper py-4 font-body text-sm font-medium tracking-widest uppercase hover:bg-ink/90 active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Criando reserva...' : `Garantir horário · ${formatCurrency(total)}`}
            </button>
          </section>
        )}

        {/* Pricing info */}
        <section className="border-t border-ink/10 pt-10">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-body text-xs tracking-widest uppercase text-muted">O que está incluído</h3>
            <span className="font-display text-2xl">{formatCurrency(BASE_PRICE)}</span>
          </div>
          <ul className="space-y-2 text-sm font-body text-muted">
            {[
              'Até 3 looks diferentes',
              '1 hora de sessão de cliques',
              'Direção e acompanhamento durante os cliques',
              'Após a sessão você escolhe quantas fotos deseja (editadas em alta resolução)',
              'Cada foto a partir de R$ 80 — valores podem ser negociados presencialmente no estúdio',
            ].map(item => (
              <li key={item} className="flex items-center gap-3">
                <span className="text-accent text-xs">—</span>
                {item}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted/60 font-body mt-6 leading-relaxed">
            Look adicional a partir de R$ 80<br />
            Rua Miranda Valverde, 123 — Botafogo, Rio de Janeiro
          </p>
        </section>
      </main>
    </div>
  )
}
