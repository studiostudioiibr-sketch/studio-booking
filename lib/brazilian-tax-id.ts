/** CPF (11) ou CNPJ (14) — PagBank exige `customer.tax_id` nos pedidos. */

export function digitsOnlyTaxId(raw: string): string {
  return raw.replace(/\D/g, '')
}

export function isValidBrazilTaxIdDigits(digits: string): boolean {
  return digits.length === 11 || digits.length === 14
}
