# Evidências de integração — PagBank (sandbox)

**Uso:** enviar ao PagBank (e-mail, portal ou anexo). Não contém `Authorization` / token.  
**Integração:** API Orders — PIX (`qr_codes`) e cartão (`charges` + `card.encrypted` via SDK no navegador).  
**Ambiente:** sandbox (`sandbox.api.pagseguro.com`).


---

## 1. Identificação

| Campo | Valor |
|-------|--------|
| Nome do sistema / loja | Studio II — agendamento |
| URL pública da aplicação | `https://studio-booking-nu.vercel.app` |
| URL de notificação (webhook) | `https://studio-booking-nu.vercel.app/api/webhook/pagbank` |
| Ambiente | Sandbox |
| Data/hora dos testes (logs Vercel) | 2026-04-06 (ex.: ~20:38 BRT PIX; ~20:52 BRT cartão + webhook; timestamps UTC nos logs) |

---

## 2. PIX — `POST /orders` (request + response 201)

**Request** (`[PagBank][orders][PIX] request` — corpo JSON enviado ao PagBank):

```json
{"reference_id":"01d282c6-7087-439a-9db2-01518c4c337e","customer":{"name":"Maria silva","email":"maria@maria.com","tax_id":"11878937650"},"items":[{"name":"Sessao Fotografica Studio II","quantity":1,"unit_amount":20000}],"qr_codes":[{"amount":{"value":20000},"expiration_date":"2026-04-06T23:52:28.589Z"}],"notification_urls":["https://studio-booking-nu.vercel.app/api/webhook/pagbank"]}
```

**Response** (`[PagBank][orders][PIX] response 201`):

```json
{"id":"ORDE_0C617017-2004-4F86-A10C-E0E5BA5483B7","reference_id":"01d282c6-7087-439a-9db2-01518c4c337e","created_at":"2026-04-06T20:38:28.871-03:00","customer":{"name":"Maria silva","email":"maria@maria.com","tax_id":"11878937650"},"items":[{"name":"Sessao Fotografica Studio II","quantity":1,"unit_amount":20000}],"qr_codes":[{"id":"QRCO_66AF7326-4F8D-413B-8EF9-7B4D2398A272","expiration_date":"2026-04-06T20:52:28.000-03:00","amount":{"value":20000},"text":"00020101021226850014br.gov.bcb.pix2563api-h.pagseguro.com/pix/v2/66AF7326-4F8D-413B-8EF9-7B4D2398A27227600016BR.COM.PAGSEGURO013666AF7326-4F8D-413B-8EF9-7B4D2398A2725204581253039865406200.005802BR5922SHEISLANE DOS SANTOS R6014RIO DE JANEIRO62070503***6304D3F2","arrangements":["PIX"],"links":[{"rel":"QRCODE.PNG","href":"https://sandbox.api.pagseguro.com/qrcode/QRCO_66AF7326-4F8D-413B-8EF9-7B4D2398A272/png","media":"image/png","type":"GET"},{"rel":"QRCODE.BASE64","href":"https://sandbox.api.pagseguro.com/qrcode/QRCO_66AF7326-4F8D-413B-8EF9-7B4D2398A272/base64","media":"text/plain","type":"GET"}]}],"notification_urls":["https://studio-booking-nu.vercel.app/api/webhook/pagbank"],"links":[{"rel":"SELF","href":"https://sandbox.api.pagseguro.com/orders/ORDE_0C617017-2004-4F86-A10C-E0E5BA5483B7","media":"application/json","type":"GET"},{"rel":"PAY","href":"https://sandbox.api.pagseguro.com/orders/ORDE_0C617017-2004-4F86-A10C-E0E5BA5483B7/pay","media":"application/json","type":"POST"}]}
```

**IDs:** pedido `ORDE_0C617017-2004-4F86-A10C-E0E5BA5483B7` · `reference_id` `01d282c6-7087-439a-9db2-01518c4c337e` · QR `QRCO_66AF7326-4F8D-413B-8EF9-7B4D2398A272`

---

## 3. Cartão — `POST /orders` (request + response 201, PAID, 20000)

**Request** — trecho registado na Vercel (`[PagBank][orders][CARD] request`). O valor de `encrypted` no log aparece **abreviado**; na chamada real à API foi enviado o **blob completo** gerado pelo SDK PagSeguro.

```json
{"reference_id":"010fe210-5b04-463e-9c29-1333b9365c06","customer":{"name":"Maria silva","email":"maria@maria.com","tax_id":"11878937650"},"items":[{"name":"Sessão Fotográfica Studio II","quantity":1,"unit_amount":20000}],"notification_urls":["https://studio-booking-nu.vercel.app/api/webhook/pagbank"],"charges":[{"reference_id":"010fe210-5b04-463e-9c29-1333b9365c06","description":"Sessão Studio II","amount":{"value":20000,"currency":"BRL"},"payment_method":{"type":"CREDIT_CARD","installments":1,"capture":true,"card":{"encrypted":"hu4CFS7QMAhVZE29Z7dF5yNWn3TmiGd1SRxe5Ow6uNZzcvEV…[344 chars no log]","store":false},"holder":{"name":"MARIA SILVA","tax_id":"11878937650"}}}]}
```

**Response** (`[PagBank][orders][CARD] response 201`):

```json
{"id":"ORDE_38F408FA-EF95-423E-A999-2E115A8B65EB","reference_id":"010fe210-5b04-463e-9c29-1333b9365c06","created_at":"2026-04-06T20:52:50.861-03:00","customer":{"name":"Maria silva","email":"maria@maria.com","tax_id":"11878937650"},"items":[{"name":"Sessão Fotográfica Studio II","quantity":1,"unit_amount":20000}],"charges":[{"id":"CHAR_B839ACA1-4DB9-4E6B-A8F6-40510C3D5477","reference_id":"010fe210-5b04-463e-9c29-1333b9365c06","status":"PAID","created_at":"2026-04-06T20:52:51.228-03:00","paid_at":"2026-04-06T20:52:51.000-03:00","description":"Sessão Studio II","amount":{"value":20000,"currency":"BRL","summary":{"total":20000,"paid":20000,"refunded":0}},"payment_response":{"code":"20000","message":"SUCESSO","reference":"032416400102","raw_data":{"authorization_code":"145803","nsu":"032416400102","reason_code":"00"}},"payment_method":{"type":"CREDIT_CARD","installments":1,"capture":true,"card":{"brand":"mastercard","first_digits":"524008","last_digits":"2454","exp_month":"12","exp_year":"2026","holder":{"name":"MARIA SILVA"},"store":false,"issuer":{"name":"SYNCHRONY BANK","product":"Platinum Mastercard Card"},"country":"USA"},"soft_descriptor":"SheislaneDos"},"metadata":{"ps_order_id":"ORDE_38F408FA-EF95-423E-A999-2E115A8B65EB"},"links":[{"rel":"SELF","href":"https://sandbox.api.pagseguro.com/charges/CHAR_B839ACA1-4DB9-4E6B-A8F6-40510C3D5477","media":"application/json","type":"GET"},{"rel":"CHARGE.CANCEL","href":"https://sandbox.api.pagseguro.com/charges/CHAR_B839ACA1-4DB9-4E6B-A8F6-40510C3D5477/cancel","media":"application/json","type":"POST"}]}],"notification_urls":["https://studio-booking-nu.vercel.app/api/webhook/pagbank"],"links":[{"rel":"SELF","href":"https://sandbox.api.pagseguro.com/orders/ORDE_38F408FA-EF95-423E-A999-2E115A8B65EB","media":"application/json","type":"GET"},{"rel":"PAY","href":"https://sandbox.api.pagseguro.com/orders/ORDE_38F408FA-EF95-423E-A999-2E115A8B65EB/pay","media":"application/json","type":"POST"}]}
```

**IDs / autorização:** `ORDE_38F408FA-EF95-423E-A999-2E115A8B65EB` · `CHAR_B839ACA1-4DB9-4E6B-A8F6-40510C3D5477` · `reference_id` `010fe210-5b04-463e-9c29-1333b9365c06` · `payment_response`: **20000** / **SUCESSO** · referência/NSU **032416400102** · autorização **145803**

---

## 4. Webhook — `POST` na URL de notificação

### 4.1 Corpo JSON recebido (principal evidência de notificação)

```json
{"id":"ORDE_38F408FA-EF95-423E-A999-2E115A8B65EB","reference_id":"010fe210-5b04-463e-9c29-1333b9365c06","created_at":"2026-04-06T20:52:50.861-03:00","customer":{"name":"Maria silva","email":"maria@maria.com","tax_id":"11878937650"},"items":[{"name":"Sessão Fotográfica Studio II","quantity":1,"unit_amount":20000}],"charges":[{"id":"CHAR_B839ACA1-4DB9-4E6B-A8F6-40510C3D5477","reference_id":"010fe210-5b04-463e-9c29-1333b9365c06","status":"PAID","created_at":"2026-04-06T20:52:51.228-03:00","paid_at":"2026-04-06T20:52:51.000-03:00","description":"Sessão Studio II","amount":{"value":20000,"currency":"BRL","summary":{"total":20000,"paid":20000,"refunded":0,"incremented":0}},"payment_response":{"code":"20000","message":"SUCESSO","reference":"032416400102","raw_data":{"authorization_code":"145803","nsu":"032416400102","reason_code":"00"}},"payment_method":{"type":"CREDIT_CARD","installments":1,"capture":true,"card":{"brand":"mastercard","first_digits":"524008","last_digits":"2454","exp_month":"12","exp_year":"2026","holder":{"name":"MARIA SILVA"},"issuer":{"name":"SYNCHRONY BANK","product":"Platinum Mastercard Card"},"country":"USA"},"soft_descriptor":"SheislaneDos"},"links":[{"rel":"SELF","href":"https://sandbox.api.pagseguro.com/charges/CHAR_B839ACA1-4DB9-4E6B-A8F6-40510C3D5477","media":"application/json","type":"GET"},{"rel":"CHARGE.CANCEL","href":"https://sandbox.api.pagseguro.com/charges/CHAR_B839ACA1-4DB9-4E6B-A8F6-40510C3D5477/cancel","media":"application/json","type":"POST"}],"metadata":{"ps_order_id":"ORDE_38F408FA-EF95-423E-A999-2E115A8B65EB"}}],"notification_urls":["https://studio-booking-nu.vercel.app/api/webhook/pagbank"],"links":[{"rel":"SELF","href":"https://sandbox.api.pagseguro.com/orders/ORDE_38F408FA-EF95-423E-A999-2E115A8B65EB","media":"application/json","type":"GET"},{"rel":"PAY","href":"https://sandbox.api.pagseguro.com/orders/ORDE_38F408FA-EF95-423E-A999-2E115A8B65EB/pay","media":"application/json","type":"POST"}]}
```

**Resumo interpretado pela aplicação** (`[webhook/pagbank] parsed`):

```json
{"event":"ORDER","order_id":"ORDE_38F408FA-EF95-423E-A999-2E115A8B65EB","reference_id":"010fe210-5b04-463e-9c29-1333b9365c06","order_status":"","charges":"CHAR_B839ACA1-4DB9-4E6B-A8F6-40510C3D5477:PAID"}
```

**Nota:** com o pedido na **raiz** do JSON, `order_status` pode vir vazio no resumo; o pagamento confirmado está em **`charges[].status: PAID`**.

### 4.2 Notificação adicional (formato legado) — opcional

Corpo recebido (form-urlencoded), mesmo teste:

```
notificationCode=217E1B-D8B05EB05E4D-1444D26F851C-1315F2&notificationType=transaction
```

A aplicação responde **200** e não usa este formato para a API Orders; serve só como prova de que a URL recebeu também este tipo de chamada.

---

## 5. Checklist

| Item | Estado neste pacote |
|------|---------------------|
| PIX request + response 201 | Incluído (§2) |
| Cartão request + response 201, PAID, 20000 | Incluído (§3) |
| Webhook com JSON do pedido + `parsed` | Incluído (§4.1) |
| `notificationCode` / `notificationType=transaction` | Opcional (§4.2) |

