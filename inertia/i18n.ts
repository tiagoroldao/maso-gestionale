/**
 * Translations for the Vue pages, read from the same ICU catalogue the
 * server uses (resources/lang/<locale>/*.json). A key is the file name
 * followed by the path inside it, e.g. "ui.customers.title".
 */
import { IntlMessageFormat } from 'intl-messageformat'

export const LOCALE = 'it'
export { TIME_ZONE, formatDate, todayIso } from '@shared/dates'
export { formatMoney } from '@shared/money'

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
    // Same option as the server's formatter, so markup in a message is plain text
    formatter = new IntlMessageFormat(message, LOCALE, undefined, { ignoreTag: true })
    formatters.set(key, formatter)
  }
  return String(formatter.format(values as Record<string, string | number>))
}

const unitPrice = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: 'EUR',
  useGrouping: 'always',
  maximumFractionDigits: 4,
})

/**
 * A unit price, keeping up to 4 decimals ("0,0345 €") so cheap parts aren't
 * shown rounded to the cent (ADR 0007).
 */
export function formatUnitPrice(amount: string | number) {
  return unitPrice.format(amount as Parameters<typeof unitPrice.format>[0])
}
