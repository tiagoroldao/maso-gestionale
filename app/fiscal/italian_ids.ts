/**
 * Checksums for Italian identifiers used on invoices and in company
 * settings. Each function expects an already upper-cased, trimmed value.
 */

/**
 * Partita IVA: 11 digits, the last being a Luhn-style check digit.
 */
export function isValidVatNumber(value: string) {
  if (!/^\d{11}$/.test(value)) return false

  let sum = 0
  for (let i = 0; i < 10; i++) {
    let digit = Number(value[i])
    if (i % 2 === 1) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
  }
  return (10 - (sum % 10)) % 10 === Number(value[10])
}

const ODD_VALUES: Record<string, number> = Object.fromEntries(
  [...'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((char, i) => [
    char,
    [
      1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6,
      8, 12, 14, 16, 10, 22, 25, 24, 23,
    ][i],
  ])
)

function evenValue(char: string) {
  return /\d/.test(char) ? Number(char) : char.charCodeAt(0) - 65
}

/**
 * Codice Fiscale: either a person's 16-character code (with its check
 * letter, omocodia variants included) or a company's 11-digit code,
 * which follows the Partita IVA rules.
 */
export function isValidTaxCode(value: string) {
  if (/^\d{11}$/.test(value)) return isValidVatNumber(value)

  const digit = '[0-9LMNPQRSTUV]'
  const pattern = new RegExp(`^[A-Z]{6}${digit}{2}[A-Z]${digit}{2}[A-Z]${digit}{3}[A-Z]$`)
  if (!pattern.test(value)) return false

  let sum = 0
  for (let i = 0; i < 15; i++) {
    sum += i % 2 === 0 ? ODD_VALUES[value[i]] : evenValue(value[i])
  }
  return String.fromCharCode(65 + (sum % 26)) === value[15]
}

/**
 * Italian IBAN: "IT", 2 check digits, CIN letter, 5-digit ABI, 5-digit
 * CAB and a 12-character account number, verified with ISO 7064 mod 97.
 */
export function isValidItalianIban(value: string) {
  if (!/^IT\d{2}[A-Z]\d{10}[0-9A-Z]{12}$/.test(value)) return false

  const rearranged = value.slice(4) + value.slice(0, 4)
  let remainder = 0
  for (const char of rearranged) {
    const chunk = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55)
    for (const d of chunk) remainder = (remainder * 10 + Number(d)) % 97
  }
  return remainder === 1
}
