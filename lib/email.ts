import { Resend } from 'resend'
import { Reservation } from './types'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { toZonedTime } from 'date-fns-tz'

const TZ = 'America/Sao_Paulo'

function getResendClient() {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is not configured')
  }
  return new Resend(process.env.RESEND_API_KEY)
}

function formatCurrency(cents: number) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatSlotDate(isoString: string) {
  const date = toZonedTime(parseISO(isoString), TZ)
  return format(date, "EEEE, dd 'de' MMMM 'às' HH:mm", { locale: ptBR })
}

// ─── Confirmation email ───────────────────────────────────────────────────────

export async function sendConfirmationEmail(reservation: Reservation): Promise<void> {
  const resend = getResendClient()
  const addons: string[] = JSON.parse(reservation.addons || '[]')
  const slotLabel = formatSlotDate(reservation.slot_datetime)

  const addonLines = addons.length > 0
    ? `<p style="margin:0 0 8px"><strong>Adicionais:</strong> ${addons.join(', ')}</p>`
    : ''

  const hasArriveEarly = addons.includes('makeup')
  const earlyNote = hasArriveEarly
    ? `<p style="margin:16px 0 0;padding:12px;background:#FEF9EE;border-left:3px solid #C8A96E;font-size:13px;color:#7A6030">⚠️ Você adicionou maquiador — chegue com <strong>30 minutos de antecedência</strong>.</p>`
    : ''

  const html = `
<!DOCTYPE html>
<html lang="pt-br">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#F5F2ED;font-family:Georgia,serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F2ED;padding:40px 16px">
    <tr><td>
      <table width="600" align="center" cellpadding="0" cellspacing="0" style="background:#0A0A0A;max-width:600px;width:100%">
        
        <!-- Header -->
        <tr>
          <td style="padding:40px 48px 32px;border-bottom:1px solid #222">
            <p style="margin:0;font-size:11px;letter-spacing:0.3em;color:#8A8070;text-transform:uppercase">Studio II</p>
            <h1 style="margin:16px 0 0;font-size:32px;font-weight:400;color:#F5F2ED;letter-spacing:-0.02em;line-height:1.2">
              Sua sessão está<br><em style="font-style:italic;color:#C8A96E">confirmada.</em>
            </h1>
          </td>
        </tr>

        <!-- Details -->
        <tr>
          <td style="padding:32px 48px">
            <p style="margin:0 0 24px;font-size:14px;color:#8A8070;text-transform:uppercase;letter-spacing:0.15em">Detalhes da reserva</p>
            
            <p style="margin:0 0 8px;font-size:15px;color:#F5F2ED"><strong style="color:#C8A96E">📅</strong> ${slotLabel}</p>
            <p style="margin:0 0 8px;font-size:15px;color:#F5F2ED"><strong style="color:#C8A96E">📍</strong> Rua Miranda Valverde, 123 — Botafogo, Rio de Janeiro</p>
            ${addonLines}
            <p style="margin:16px 0 0;font-size:15px;color:#F5F2ED"><strong style="color:#C8A96E">💳</strong> Total pago: ${formatCurrency(reservation.total_cents)}</p>

            ${earlyNote}
          </td>
        </tr>

        <!-- What to bring -->
        <tr>
          <td style="padding:0 48px 32px">
            <div style="border-top:1px solid #222;padding-top:24px">
              <p style="margin:0 0 12px;font-size:11px;letter-spacing:0.2em;color:#8A8070;text-transform:uppercase">O que trazer</p>
              <p style="margin:0;font-size:14px;color:#8A8070;line-height:1.7">
                Suas roupas para até 3 looks diferentes.<br>
                Hidratante, desodorante e itens de higiene pessoal.<br>
                Boa energia — o resto a gente cuida. ✨
              </p>
            </div>
          </td>
        </tr>

        <!-- Contact -->
        <tr>
          <td style="padding:24px 48px;background:#111;border-top:1px solid #222">
            <p style="margin:0;font-size:13px;color:#8A8070">
              Dúvidas? Fala com a gente:<br>
              <a href="https://wa.me/5521959023665" style="color:#C8A96E;text-decoration:none">WhatsApp (21) 95902-3665</a> &nbsp;·&nbsp;
              <a href="https://instagram.com/studioiibr" style="color:#C8A96E;text-decoration:none">@studioiibr</a>
            </p>
            <p style="margin:16px 0 0;font-size:11px;color:#444;letter-spacing:0.1em">
              ID DA RESERVA: ${reservation.id}
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`

  await resend.emails.send({
    from: process.env.EMAIL_FROM!,
    to: reservation.cliente_email,
    subject: `✅ Sessão confirmada — Studio II — ${slotLabel}`,
    html,
  })
}

// ─── Expiration reminder (optional) ──────────────────────────────────────────

export async function sendExpirationWarningEmail(params: {
  cliente_email: string
  cliente_nome: string
  minutes_left: number
}): Promise<void> {
  const resend = getResendClient()
  await resend.emails.send({
    from: process.env.EMAIL_FROM!,
    to: params.cliente_email,
    subject: `⏰ Você tem ${params.minutes_left} min para finalizar sua reserva — Studio II`,
    html: `
      <p>Olá, ${params.cliente_nome}!</p>
      <p>Sua pré-reserva expira em <strong>${params.minutes_left} minutos</strong>. Finalize o pagamento para garantir seu horário.</p>
      <p><a href="${process.env.NEXT_PUBLIC_APP_URL}/checkout">Finalizar agora →</a></p>
    `,
  })
}
