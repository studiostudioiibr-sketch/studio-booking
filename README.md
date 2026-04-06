# Studio II — Booking App

Sistema de agendamento online para sessões fotográficas com:
- Pré-reserva com **soft lock** (HOLD por X minutos)
- Integração com **Google Calendar** (slots disponíveis)
- Integração com **Google Sheets** (banco de dados de reservas)
- Pagamento via **PIX e Cartão (PagBank)**
- E-mail de confirmação via **Resend**

---

## Stack

```
Next.js 14 (App Router) + TypeScript
Google Calendar API  → fonte de slots disponíveis
Google Sheets API    → banco de dados de reservas
PagBank              → gateway PIX e cartão de crédito
Resend               → e-mail transacional
Vercel               → deploy
```

---

## Estados de uma reserva

```
LIVRE → HOLD (X min) → CONFIRMADO
                  ↓
              EXPIRADO → LIVRE (lazy expiration)
```

- **LIVRE**: slot disponível no Calendar, sem reserva ativa no Sheets
- **HOLD**: usuário selecionou o slot e está no checkout (soft lock)
- **CONFIRMADO**: pagamento confirmado via webhook
- **EXPIRADO**: HOLD cujo `expires_at` passou sem pagamento (liberado automaticamente na próxima consulta)

---

## Setup em 3 horas — passo a passo

### 1. Clonar e instalar

```bash
git clone <seu-repo>
cd studio-booking
npm install
cp .env.example .env.local
```

### 2. Google Cloud — Service Account

1. Acesse [console.cloud.google.com](https://console.cloud.google.com)
2. Crie um projeto (ou use um existente)
3. Ative as APIs:
   - **Google Calendar API**
   - **Google Sheets API**
4. Vá em **IAM → Service Accounts → Create Service Account**
5. Dê um nome (ex: `studio-booking`)
6. Crie e baixe a chave JSON
7. Copie o conteúdo do JSON e cole em `GOOGLE_SERVICE_ACCOUNT_JSON` no `.env.local`
   - **Atenção**: coloque tudo em uma linha (minifique o JSON se necessário)

### 3. Google Sheets

1. Crie uma planilha em [sheets.google.com](https://sheets.google.com)
2. Renomeie a aba para `reservas`
3. Copie o ID da URL: `docs.google.com/spreadsheets/d/**SEU_ID_AQUI**/edit`
4. Cole em `GOOGLE_SHEET_ID` no `.env.local`
5. Compartilhe a planilha com o e-mail da Service Account (com permissão de **Editor**)
6. Rode o setup para criar o cabeçalho:
   ```
   GET /api/setup?token=SEU_TOKEN_SETUP
   ```
   (defina `SETUP_TOKEN` no `.env.local`)

### 4. Google Calendar

1. Abra o [Google Calendar](https://calendar.google.com)
2. Crie um calendário dedicado para o estúdio (ou use o existente)
3. Compartilhe o calendário com o e-mail da Service Account (permissão de **Editor**)
4. Vá em Configurações do calendário → "Integrar agenda" → copie o **Calendar ID**
5. Cole em `GOOGLE_CALENDAR_ID` no `.env.local`
6. Defina `STUDIO_NOTIFICATION_EMAIL` com o e-mail operacional do estúdio
   (será incluído como attendee nas confirmações)
7. Garanta que a Service Account tenha permissão de **Editor** no calendário
   (leitura e escrita de eventos)
8. Crie eventos para os slots disponíveis com títulos como:
   - `Slot 09:00`
   - `Disponível 14:00`
10. Sem evento de disponibilidade em um dia, esse dia ficará sem horários no site
    (não existe fallback automático de horários fixos).
9. Após pagamento confirmado, o app tenta localizar o evento de disponibilidade
   no mesmo dia/horário (comparação por instante UTC) e aplica patch:
   - título: `Reservado · Nome do Cliente`
   - descrição: cliente + `Maquiadora: Sim/Não` + `Figurinista: Sim/Não`
   - attendees: studio + cliente, com `sendUpdates=all`

### 5. PagBank (PIX + Cartão)

1. Crie conta em [pagseguro.uol.com.br](https://pagseguro.uol.com.br)
2. Acesse **Preferências → Integrações → Token de Segurança**
3. Cole em `PAGBANK_TOKEN` e `PAGBANK_EMAIL`
4. **Chave pública para cartão** (obrigatória — o cartão é criptografado no navegador com o [SDK PagBank](https://developer.pagbank.com.br/reference/criar-pagar-pedido-com-cartao)):
   - Sandbox:
     ```bash
     curl -s -X POST 'https://sandbox.api.pagseguro.com/public-keys' \
       -H "Authorization: Bearer SEU_TOKEN_SANDBOX" \
       -H "Content-Type: application/json" \
       -d '{"type":"card"}'
     ```
   - Produção: mesmo `POST`, host `https://api.pagseguro.com/public-keys`
   - Copie o valor `public_key` da resposta para `PAGBANK_PUBLIC_KEY` (Vercel / `.env.local`)
5. Configure o webhook para:
   ```
   https://seu-app.vercel.app/api/webhook/pagbank
   ```
6. Garanta `NEXT_PUBLIC_APP_URL` igual à URL pública do app (usado em `notification_urls` nos pedidos).
7. Para testes, use `PAGBANK_ENV=sandbox` e token + chave pública do sandbox.

**CPF/CNPJ do pagador:** a API PagBank exige [`customer.tax_id`](https://developer.pagbank.com.br/reference/criar-pedido) (11 ou 14 dígitos) em todo pedido. O fluxo de agendamento pede **CPF ou CNPJ** junto com os dados pessoais; no checkout há o mesmo campo para conferência ou para reservas antigas sem documento salvo.

**Logs de homologação:** com cartão criptografado, o request para `/orders` leva `charges[].payment_method.card.encrypted` (Base64), sem número/CVV em claro. Capture request/response reais do sandbox (DevTools → Network na sua API, ou logs do servidor) para enviar ao PagBank.

### 6. Resend (E-mail) — opcional

Se você **não** configurar `RESEND_API_KEY` e `EMAIL_FROM`, o app **não envia e-mail**; o cliente recebe o **comprovante na tela do checkout** (copiar texto, imprimir ou salvar em PDF).

1. Crie conta em [resend.com](https://resend.com) (gratuito até 3k emails/mês)
2. Adicione e verifique seu domínio
3. Crie uma API Key
4. Cole em `RESEND_API_KEY`
5. Atualize `EMAIL_FROM` com seu domínio verificado

### 7. Variáveis de ambiente — resumo

```env
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
GOOGLE_CALENDAR_ID=studio@gmail.com
STUDIO_NOTIFICATION_EMAIL=studio@seudominio.com
GOOGLE_SHEET_ID=1BxiMV...
PAGBANK_TOKEN=...
PAGBANK_EMAIL=...
PAGBANK_PUBLIC_KEY=...
PAGBANK_ENV=sandbox
RESEND_API_KEY=re_...
EMAIL_FROM=Studio II <reservas@seudominio.com>
NEXT_PUBLIC_APP_URL=https://seu-app.vercel.app
HOLD_TIMEOUT_MINUTES=15
BASE_PRICE_CENTS=20000
ADDON_MAKEUP_CENTS=16000
ADDON_STYLIST_CENTS=30000
SETUP_TOKEN=qualquer-string-secreta
NEXT_PUBLIC_BASE_PRICE_CENTS=20000
NEXT_PUBLIC_HOLD_TIMEOUT_MINUTES=15
```

### 8. Rodar local

```bash
npm run dev
# Abra http://localhost:3000
```

Para testar webhooks localmente, use o [ngrok](https://ngrok.com):
```bash
ngrok http 3000
# Use a URL gerada como NEXT_PUBLIC_APP_URL e configure nos gateways
```

### 9. Deploy na Vercel

```bash
npm install -g vercel
vercel --prod
```

Adicione todas as variáveis de ambiente no painel da Vercel em:
**Project → Settings → Environment Variables**

---

## Estrutura do projeto

```
studio-booking/
├── app/
│   ├── page.tsx                    # Landing page + seleção de data/hora/dados
│   ├── checkout/page.tsx           # Timer + PIX + Cartão + confirmação
│   ├── globals.css
│   ├── layout.tsx
│   └── api/
│       ├── slots/route.ts          # GET  /api/slots?date=YYYY-MM-DD
│       ├── booking/
│       │   ├── route.ts            # POST /api/booking (cria HOLD)
│       │   └── status/route.ts     # GET  /api/booking/status?id=...
│       ├── payment/
│       │   ├── pix/route.ts        # POST /api/payment/pix (PagBank)
│       │   └── card/route.ts       # POST /api/payment/card (PagBank)
│       ├── webhook/
│       │   └── pagbank/route.ts    # POST /api/webhook/pagbank
│       └── setup/route.ts          # GET  /api/setup?token=...
├── lib/
│   ├── types.ts                    # Tipos TypeScript compartilhados
│   ├── google-sheets.ts            # CRUD de reservas
│   ├── google-calendar.ts          # Leitura de slots + criação de evento
│   ├── pagbank.ts                  # PIX + Cartão
│   └── email.ts                    # E-mail de confirmação
├── .env.example
└── README.md
```

---

## Fluxo completo

```
1. Usuário acessa /
2. Seleciona data → GET /api/slots?date=... (Calendar + Sheets)
3. Seleciona horário
4. Preenche dados pessoais
5. Seleciona addons (opcional)
6. Clica "Garantir horário" → POST /api/booking
   └─ Verifica slot disponível (optimistic lock)
   └─ Cria reserva com status HOLD + expires_at
   └─ Retorna reservation_id + expires_at
7. Redireciona para /checkout (com timer regressivo)
8a. PIX: POST /api/payment/pix → gera QR Code PagBank
    └─ Frontend faz polling em /api/booking/status a cada 3s
    └─ PagBank dispara webhook → /api/webhook/pagbank
       └─ Confirma no Sheets + patch de slot no Calendar (ou insert fallback) + envia e-mail
8b. Cartão: POST /api/payment/card → PagBank
    └─ Aprovado → confirma no Sheets + patch/insert no Calendar + e-mail
    └─ PagBank dispara webhook → /api/webhook/pagbank (redundância)
9. Tela de confirmação
```

---

## Regras operacionais de agenda (negócio)

1. O cliente só vê horários cujo evento no Google Calendar tenha no título
   `slot`, `sessão` ou `disponível`.
2. Se não houver evento de disponibilidade em um dia, o site retorna lista vazia
   de slots para essa data.
3. Quando um pagamento é confirmado, o app procura um evento de disponibilidade
   no mesmo dia/horário da reserva (match por instante UTC, timezone-safe).
4. Se encontrar, aplica patch no evento:
   - `Reservado · Nome do Cliente`
   - informações de maquiagem/figurinista em `Sim/Não`
   - attendees com studio + cliente, solicitando e-mails do Google.
5. Se não encontrar evento compatível, cria evento de sessão confirmada
   como fallback operacional.

---

## Tratamento de concorrência

O projeto usa **optimistic locking** + **lazy expiration**:

1. Ao criar um HOLD, a API relê todas as reservas ativas antes de inserir
2. Se outro usuário criou um HOLD ativo para o mesmo slot nos últimos X ms, retorna erro 409
3. Reservas HOLD com `expires_at` no passado são tratadas como LIVRE em todas as queries
4. Não há cron job — a limpeza acontece naturalmente a cada consulta de slots

Para volumes maiores (> 50 reservas/dia), considere migrar para **Upstash Redis** como camada de lock, mantendo o Sheets só como registro histórico.
