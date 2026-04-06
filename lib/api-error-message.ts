/** Mensagem segura para JSON de erro (trunca corpos longos do PagBank). */
export function publicErrorMessage(err: unknown, fallback: string, maxLen = 800): string {
  if (err instanceof Error && err.message?.trim()) {
    const m = err.message.trim()
    return m.length > maxLen ? `${m.slice(0, maxLen)}…` : m
  }
  return fallback
}
