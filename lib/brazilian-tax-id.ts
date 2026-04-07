/** CPF (11) ou CNPJ (14) — PagBank exige `customer.tax_id` nos pedidos. */

export function digitsOnlyTaxId(raw: string): string {
  return raw.replace(/\D/g, '')
}

function isRepeatedDigitString(d: string): boolean {
  return /^(\d)\1+$/.test(d)
}

function isValidCpfDigits(d: string): boolean {
  if (d.length !== 11 || isRepeatedDigitString(d)) return false

  let sum = 0
  for (let i = 0; i < 9; i++) {
    sum += Number(d[i]) * (10 - i)
  }
  let mod = sum % 11
  const d1 = mod < 2 ? 0 : 11 - mod
  if (d1 !== Number(d[9])) return false

  sum = 0
  for (let i = 0; i < 10; i++) {
    sum += Number(d[i]) * (11 - i)
  }
  mod = sum % 11
  const d2 = mod < 2 ? 0 : 11 - mod
  return d2 === Number(d[10])
}

function isValidCnpjDigits(d: string): boolean {
  if (d.length !== 14 || isRepeatedDigitString(d)) return false

  const calcCheck = (base: string, length: number): number => {
    let sum = 0
    let pos = length - 7
    for (let i = length; i >= 1; i--) {
      sum += Number(base[length - i]) * pos--
      if (pos < 2) pos = 9
    }
    const mod = sum % 11
    return mod < 2 ? 0 : 11 - mod
  }

  const base12 = d.slice(0, 12)
  const d1 = calcCheck(base12, 12)
  if (d1 !== Number(d[12])) return false

  const base13 = d.slice(0, 13)
  const d2 = calcCheck(base13, 13)
  return d2 === Number(d[13])
}

/** CPF ou CNPJ com dígitos verificadores válidos (algoritmo oficial). */
export function isValidBrazilTaxIdDigits(digits: string): boolean {
  if (digits.length === 11) return isValidCpfDigits(digits)
  if (digits.length === 14) return isValidCnpjDigits(digits)
  return false
}
