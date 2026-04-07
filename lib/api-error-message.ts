/** Mensagem segura para JSON de erro (trunca corpos longos do PagBank). */

type PagBankErrorPayload = {
  error_messages?: Array<{
    code?: string
    description?: string
    parameter_name?: string
  }>
}

function humanizePagBankPayload(data: PagBankErrorPayload): string | null {
  const msgs = data.error_messages
  if (!Array.isArray(msgs) || msgs.length === 0) return null

  const taxIdIssue = msgs.some(m => {
    const p = (m.parameter_name ?? '').toLowerCase()
    const d = (m.description ?? '').toLowerCase()
    return (
      p.includes('tax_id') ||
      d.includes('cpf') ||
      d.includes('cnpj') ||
      m.code === '40002'
    )
  })
  if (taxIdIssue) {
    return 'O CPF ou CNPJ informado não é válido. Confira os dígitos e tente de novo.'
  }

  const firstDesc = msgs.map(m => m.description).find(Boolean)
  if (firstDesc && firstDesc.length < 200) return firstDesc

  return null
}

function tryParsePagBankJsonFromMessage(message: string): PagBankErrorPayload | null {
  const prefix = message.match(/^PagBank(?:\s+PIX)?\s+error\s+\d+:\s*([\s\S]*)$/)
  const jsonSlice = prefix?.[1]?.trim() ?? (message.trim().startsWith('{') ? message.trim() : null)
  if (!jsonSlice) return null
  try {
    return JSON.parse(jsonSlice) as PagBankErrorPayload
  } catch {
    return null
  }
}

/** Converte erros brutos do PagBank (JSON no texto) em mensagem legível em português. */
export function humanizePagBankErrorMessage(message: string): string | null {
  const parsed = tryParsePagBankJsonFromMessage(message)
  if (!parsed) return null
  return humanizePagBankPayload(parsed)
}

export function publicErrorMessage(err: unknown, fallback: string, maxLen = 800): string {
  if (err instanceof Error && err.message?.trim()) {
    const m = err.message.trim()
    const friendly = humanizePagBankErrorMessage(m)
    if (friendly) return friendly
    if (/PagBank(?:\s+PIX)?\s+error\s+\d+:/i.test(m)) {
      return 'Não foi possível concluir o pagamento. Verifique os dados e tente de novo.'
    }
    return m.length > maxLen ? `${m.slice(0, maxLen)}…` : m
  }
  return fallback
}
