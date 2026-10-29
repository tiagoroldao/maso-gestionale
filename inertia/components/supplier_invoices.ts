import { LOCALE, t } from '~/i18n'
import { ALL_PAYMENT_METHODS, DOCUMENT_TYPES } from '@shared/supplier_invoices'

/**
 * A FatturaPA document type (TipoDocumento) by name, or its code when the
 * catalogue doesn't name it.
 */
export function documentTypeLabel(code: string) {
  return (DOCUMENT_TYPES as readonly string[]).includes(code)
    ? t(`ui.supplierInvoices.documentTypes.${code}`)
    : code
}

/** A payment method (ModalitaPagamento) by name, or its code */
export function paymentMethodLabel(code: string) {
  return ALL_PAYMENT_METHODS.includes(code)
    ? `${t(`ui.supplierInvoices.paymentMethods.${code}`)} (${code})`
    : code
}

/**
 * An amount in the invoice's currency, Italian style; unit prices keep up
 * to the 8 decimals FatturaPA allows.
 */
export function formatAmount(amount: string, currency: string, maxDecimals = 2) {
  try {
    return new Intl.NumberFormat(LOCALE, {
      style: 'currency',
      currency,
      useGrouping: 'always',
      minimumFractionDigits: 2,
      maximumFractionDigits: maxDecimals,
    }).format(amount as unknown as number)
  } catch {
    // Not a currency code Intl knows
    return `${amount} ${currency}`
  }
}
