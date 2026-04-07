# Homologação PagBank — guia consolidado (Studio Booking)

Documento único com configuração, testes, logs na Vercel, webhook e problemas comuns. O código relevante está em `lib/pagbank.ts`, `lib/pagbank-log.ts`, `app/api/payment/*` e `app/api/webhook/pagbank/route.ts`.

---

## 1. Variáveis de ambiente (o que não pode falhar)

| Variável | Função |
|----------|--------|
| `PAGBANK_TOKEN` | Bearer em todas as chamadas `POST /orders` (PIX e cartão). |
| `PAGBANK_PUBLIC_KEY` | Chave pública **tipo `card`**, gerada com o **mesmo** token e **mesmo** ambiente (sandbox ou produção). Usada só no **cartão** (criptografia no navegador). |
| `PAGBANK_ENV` | `sandbox` ou `production` — define host da API (`sandbox.api.pagseguro.com` vs `api.pagseguro.com`). |
| `NEXT_PUBLIC_APP_URL` | URL pública do app **sem** barra final desnecessária. Usada para montar `notification_urls` → `/api/webhook/pagbank`. |

**Gerar chave pública de cartão (sandbox):**

```bash
curl -s -X POST 'https://sandbox.api.pagseguro.com/public-keys' \
  -H "Authorization: Bearer SEU_TOKEN_SANDBOX" \
  -H "Content-Type: application/json" \
  -d '{"type":"card"}'
```

Copie `public_key` para `PAGBANK_PUBLIC_KEY` na Vercel. Em produção, use `https://api.pagseguro.com/public-keys` com token de produção.

**CPF/CNPJ:** a API exige `customer.tax_id` (11 ou 14 dígitos) em todo pedido. O app coleta no fluxo e no checkout.

---

## 2. PIX vs cartão — por que um pode funcionar e o outro não

- **PIX:** só usa `PAGBANK_TOKEN` no servidor. Pedido com `qr_codes` no `POST /orders`. **Não** usa `PAGBANK_PUBLIC_KEY`.
- **Cartão:** o servidor usa o **mesmo** token, mas o corpo traz `charges[].payment_method.card.encrypted`, gerado no browser com `PAGBANK_PUBLIC_KEY` (SDK PagSeguro).

Se o token estiver certo mas a chave pública for de **outra conta**, **outro ambiente** ou **token antigo**, o PagBank pode responder erro no campo `encrypted` (ex.: `40002` / `BRAND_NOT_FOUND`), enquanto o PIX continua **201**.

---

## 3. Roteiro de testes (sandbox)

1. Confirmar na Vercel: `PAGBANK_ENV=sandbox`, `NEXT_PUBLIC_APP_URL` = URL real do projeto, token + `PAGBANK_PUBLIC_KEY` do sandbox (chave criada com o mesmo Bearer).
2. Opcional: abrir `https://SEU-DOMINIO/api/payment/pagbank-config` — deve retornar `{"publicKey":"..."}`.
3. **PIX:** agendar → checkout → CPF/CNPJ válido → gerar QR. Ver logs `[PagBank][orders][PIX]`.
4. **Cartão:** usar **apenas** cartões de teste oficiais do PagBank no sandbox. Ver logs `[PagBank][orders][CARD]`.
5. **Webhook:** após pagamento **PAID**, o PagBank faz `POST` em `https://SEU-DOMINIO/api/webhook/pagbank`. Pode haver atraso de segundos. Conferir logs `[webhook/pagbank]`.

---

## 4. Logs na Vercel — o que aparece e o que copiar

**Onde:** projeto Vercel → **Logs** (Runtime / Functions).

**Prefixos úteis:**

- `[PagBank][orders][PIX] request` / `response` — corpo do pedido PIX e resposta da API (truncados).
- `[PagBank][orders][CARD] request` / `response` — idem cartão; no **request** o campo `encrypted` aparece **truncado no log** (o envio real ao PagBank é completo).
- `[webhook/pagbank] body` — corpo bruto recebido (quando log detalhado está ativo).
- `[webhook/pagbank] parsed` — JSON com `order_id`, `reference_id`, `order_status`, resumo de charges (`CHAR_...:PAID`).
- `[webhook/pagbank] Ignored body` — ver §5.2 (notificação legada); **não** indica falha do fluxo principal.

**Quando os logs detalhados ligam:**

- Sandbox: `PAGBANK_ENV` **diferente** de `production` → ligados por padrão.
- Produção: definir `PAGBANK_LOG_IO=true` ou `1` (cuidado: pode incluir dados pessoais nos JSON).
- `PAGBANK_LOG_MAX_CHARS` — limite de caracteres por linha (padrão 16384).

O **token** (`Authorization`) **nunca** é escrito nos logs.

**Modelo para colar em chamado / homologação:**

```text
=== Ambiente ===
URL: https://...
Data/hora do teste:
PAGBANK_ENV: sandbox

=== PIX — POST /orders ===
[colar linha] [PagBank][orders][PIX] request ...
[colar linha] [PagBank][orders][PIX] response ...

=== Cartão — POST /orders ===
[colar linha] [PagBank][orders][CARD] request ...
[colar linha] [PagBank][orders][CARD] response ...

=== Webhook (JSON do pedido) ===
[colar] [webhook/pagbank] body ...  (objeto com id ORDE_, charges, etc.)
[colar] [webhook/pagbank] parsed ...  (pode ter order_status vazio — ver §5.1)

=== IDs (se constarem no JSON) ===
order id (ORDE_...):
charge id (CHAR_...):
reference_id (UUID da reserva):
payment_response.code / message:
```

**Texto curto para abertura de ticket:**

> Homologação sandbox PagBank. Seguem trechos dos Function Logs da Vercel com `[PagBank][orders][PIX|CARD]` e `[webhook/pagbank]`. Token e dados sensíveis de cartão em claro não estão incluídos.

---

## 5. Webhook — o que esperar

- Cada pedido envia `notification_urls` apontando para `/api/webhook/pagbank` (derivado de `NEXT_PUBLIC_APP_URL`).
- Com cobrança **PAID**, o PagBank deve notificar essa URL. O app responde **200**, faz parse tolerante do corpo e, se for pagamento confirmado e a reserva existir em HOLD, confirma na planilha / agenda / e-mail conforme implementado.
- Se não aparecer log de webhook: conferir URL pública, HTTPS, e aguardar alguns segundos; no sandbox há relatos ocasionais de atraso.
- **Cartão aprovado:** a rota `POST /api/payment/card` pode **confirmar a reserva antes** do webhook chegar. O webhook continua sendo chamado; o handler é **idempotente** (se já estiver `CONFIRMADO`, responde 200 com `already confirmed`). Isso é normal.

### 5.1 Webhook em JSON (pedido na raiz)

O PagBank pode enviar o **objeto do pedido** direto no corpo (`{"id":"ORDE_...", "charges":[...]}`), sem envelope `{ "event", "order" }`. Nesse caso o app normaliza para uso interno.

- No log **`parsed`**, o campo **`order_status` pode vir vazio** (`""`), porque o JSON do pedido às vezes **não** traz `status` no nível raiz — o que importa para confirmação é **`charges[].status`** (ex.: `CHAR_...:PAID` no resumo do log ou `PAID` no JSON).
- A confirmação de pagamento considera **`order.status === 'PAID'`** *ou* **alguma charge com `PAID`** — fluxo cartão aprovado continua válido para homologação.

### 5.2 Segunda notificação: `notificationCode` + `notificationType=transaction`

É comum chegar **outro** `POST` pouco depois, com corpo **form-urlencoded**, por exemplo:

`notificationCode=...&notificationType=transaction`

Isso é formato **legado** (estilo API de notificações antiga do ecossistema PagSeguro). **O app não usa esse formato** para confirmar pedidos da API Orders: o endpoint responde **HTTP 200** com `{ "received": true, "note": "ignored" }` e o log pode mostrar *Ignored body (unknown shape)*.

- **Isso é esperado** e **não** invalida a homologação se o webhook **JSON** (§5.1) já foi processado ou se a confirmação já ocorreu no `POST /api/payment/card` no fluxo cartão.
- Para o template de evidências, basta anexar o par **body + parsed** do JSON; opcionalmente uma linha explicando que notificações `notificationType=transaction` são ignoradas de propósito.

---

## 6. Sucesso em cartão — o que o log costuma mostrar

Exemplo de resultado **bem-sucedido** (valores ilustrativos):

- `response 201`
- `charges[0].status`: `PAID`
- `payment_response.code`: `20000`, `message`: `SUCESSO`

Isso serve como evidência de fluxo cartão aprovado em sandbox.

---

## 7. Problemas comuns

| Sintoma | Verificar |
|---------|-----------|
| `40002` / `BRAND_NOT_FOUND` em `card.encrypted` | `PAGBANK_PUBLIC_KEY` gerada com o **mesmo** `PAGBANK_TOKEN` e **mesmo** ambiente; corpo `{"type":"card"}` no `POST /public-keys`. |
| PIX ok, cartão falha | Normal se só a chave pública estiver errada — ver tabela acima. |
| Webhook não chega | `NEXT_PUBLIC_APP_URL`, firewall, URL exata; logs da função na Vercel. |
| Log *Ignored body* com `notificationCode` / `notificationType=transaction` | Comportamento esperado (§5.2); não substitui o webhook JSON do pedido. |
| `parsed` com `order_status` vazio mas `charges` com `PAID` | Normal no JSON pedido-na-raiz (§5.1). |
| Último deploy “quebrou” cartão | Mudanças de log não alteram o JSON enviado ao PagBank; suspeitar de **env** alterado na Vercel ou chave rotacionada no painel. |

---

## 8. Referências no repositório

- `README.md` — visão geral do projeto e lista de env.
- `lib/pagbank.ts` — `createPixCharge`, `createCardCharge`, parse de webhook.
- `lib/pagbank-log.ts` — regras de log e sanitização do `encrypted`.
- `app/checkout/page.tsx` — SDK `PagSeguro.encryptCard` e envio para `/api/payment/card`.

Documentação oficial: [developer.pagbank.com.br](https://developer.pagbank.com.br).

---

## 9. Envio externo ao PagBank (só evidências)

Para **mandar a eles** sem detalhes internos do repositório, use o ficheiro enxuto com placeholders e checklist:

**[EVIDENCIAS-HOMOLOGACAO-PAGBANK-EXTERNO.md](./EVIDENCIAS-HOMOLOGACAO-PAGBANK-EXTERNO.md)**

Se o PagBank exigir **formulário/planilha próprios**, copie para lá os mesmos trechos do **§4** deste guia: IDs (`ORDE_`, `CHAR_`), `reference_id`, `payment_response` (`20000` / `SUCESSO`), logs `[PagBank][orders][…]` e `[webhook/pagbank]` — não é necessário outro formato de log no app.

Se precisarem de **mapeamento campo a campo** entre o template oficial deles e estes logs, envie o modelo (PDF/print) e preenche-se alinhado.
