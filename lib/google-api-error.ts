/**
 * Converte erros do cliente Google (gaxios) em mensagens úteis para debug em produção,
 * sem expor chaves ou stack traces.
 */

type GoogleErrorPayload = {
  error?: {
    message?: string
    status?: string
    errors?: Array<{ domain?: string; reason?: string; message?: string }>
  }
}

function readGoogleResponse(err: unknown): { httpStatus?: number; payload?: GoogleErrorPayload } {
  if (!err || typeof err !== 'object') return {}
  const e = err as { response?: { status?: number; data?: GoogleErrorPayload } }
  return {
    httpStatus: e.response?.status,
    payload: e.response?.data,
  }
}

/** Mensagem para o usuário/admin quando /api/slots ou integrações Google falham. */
export function formatGoogleIntegrationError(err: unknown): string {
  const { httpStatus, payload } = readGoogleResponse(err)
  const reason = payload?.error?.errors?.[0]?.reason
  const apiMessage = payload?.error?.message?.trim()

  if (httpStatus === 404 || reason === 'notFound') {
    return 'Calendário ou planilha não encontrado. Confira GOOGLE_CALENDAR_ID e GOOGLE_SHEET_ID na Vercel.'
  }
  if (httpStatus === 403 || reason === 'forbidden') {
    return 'Permissão negada no Google Calendar ou Sheets. Compartilhe o calendário e a planilha com o e-mail da service account (Editor). A aba da planilha deve se chamar "reservas".'
  }
  if (httpStatus === 401) {
    return 'Google recusou as credenciais. Revise GOOGLE_SERVICE_ACCOUNT_JSON (JSON válido em uma linha, chave ativa no GCP).'
  }
  if (reason === 'authError' || reason === 'invalid_client' || reason === 'unauthorized_client') {
    return 'Falha de autenticação com o Google. Ative Calendar API e Sheets API no projeto e confira a service account.'
  }
  if (reason === 'insufficientPermissions') {
    return 'A service account não tem permissão suficiente. Conceda acesso de editor ao calendário e à planilha.'
  }
  if (reason === 'badRequest') {
    return `Requisição inválida para o Google${apiMessage ? `: ${apiMessage}` : '.'}`
  }

  if (err instanceof Error) {
    const m = err.message
    if (/unexpected token|json/i.test(m) && /parse|JSON/i.test(m)) {
      return 'GOOGLE_SERVICE_ACCOUNT_JSON parece inválido (JSON quebrado ou mal colado na Vercel).'
    }
  }

  if (apiMessage && apiMessage.length > 0 && apiMessage.length < 220) {
    return `Google: ${apiMessage}`
  }

  return 'Não foi possível carregar os horários. Verifique na Vercel: GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_CALENDAR_ID, GOOGLE_SHEET_ID, APIs Calendar+Sheets ativas e compartilhamento com a service account. Veja também os logs do servidor para [GET /api/slots].'
}
