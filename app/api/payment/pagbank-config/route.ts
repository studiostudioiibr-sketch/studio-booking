import { NextResponse } from 'next/server'

/**
 * Expõe a chave pública PagBank (tipo card) para o SDK no browser criptografar o cartão.
 * Gere uma vez: POST https://sandbox.api.pagseguro.com/public-keys com Bearer token e body {"type":"card"}.
 */
export async function GET() {
  const publicKey = process.env.PAGBANK_PUBLIC_KEY?.trim()
  if (!publicKey) {
    return NextResponse.json(
      {
        error:
          'PAGBANK_PUBLIC_KEY não configurada. Crie em POST /public-keys (type: card) e defina a variável no servidor.',
      },
      { status: 503 }
    )
  }
  return NextResponse.json({ publicKey })
}
