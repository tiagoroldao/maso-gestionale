import { t } from '~/i18n'
import {
  documentTypeLabel as documentTypeLabelWith,
  paymentMethodLabel as paymentMethodLabelWith,
} from '@shared/supplier_invoices'

export { formatAmount } from '@shared/supplier_invoices'

/**
 * A FatturaPA document type (TipoDocumento) by name, or its code when the
 * catalogue doesn't name it.
 */
export function documentTypeLabel(code: string) {
  return documentTypeLabelWith(code, t)
}

/** A payment method (ModalitaPagamento) by name, or its code */
export function paymentMethodLabel(code: string) {
  return paymentMethodLabelWith(code, t)
}
