/**
 * Translations for the Vue pages, read from the same ICU catalogue the
 * server uses (resources/lang/<locale>/*.json). A key is the file name
 * followed by the path inside it, e.g. "ui.customers.title".
 */
import { IntlMessageFormat } from 'intl-messageformat'

export const LOCALE = 'it'
export const TIME_ZONE = 'Europe/Rome'

const files = import.meta.glob<Record<string, unknown>>('../resources/lang/it/*.json', {
  eager: true,
  import: 'default',
})

const messages = new Map<string, string>()

function collect(prefix: string, value: unknown) {
  if (typeof value === 'string') {
    messages.set(prefix, value)
    return
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) collect(`${prefix}.${key}`, child)
  }
}

for (const [path, contents] of Object.entries(files)) {
  const namespace = path
    .split('/')
    .pop()!
    .replace(/\.json$/, '')
  collect(namespace, contents)
}

const formatters = new Map<string, IntlMessageFormat>()

/**
 * The translated message for `key`, with ICU placeholders filled from
 * `values`. Returns the key itself (and warns in development) when the
 * translation is missing, so gaps are visible rather than blank.
 */
export function t(key: string, values?: Record<string, string | number | null | undefined>) {
  const message = messages.get(key)
  if (message === undefined) {
    if (import.meta.env.DEV) console.warn(`Missing translation: ${key}`)
    return key
  }

  let formatter = formatters.get(key)
  if (!formatter) {
    formatter = new IntlMessageFormat(message, LOCALE)
    formatters.set(key, formatter)
  }
  return String(formatter.format(values as Record<string, string | number>))
}

/**
 * A calendar date ("2026-05-20") as the business writes it ("20/05/2026"),
 * without any timezone conversion.
 */
export function formatDate(isoDate: string | null | undefined) {
  if (!isoDate) return ''
  const [year, month, day] = isoDate.slice(0, 10).split('-')
  return `${day}/${month}/${year}`
}

const money = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'EUR' })

export function formatMoney(amount: number) {
  return money.format(amount)
}

/**
 * Today's date in the business's timezone, as "YYYY-MM-DD".
 */
export function todayIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date())
}
