/**
 * FatturaPA payment methods (ModalitaPagamento) offered on Payment Terms.
 * The full list is longer; these are the ones a plumbing business uses.
 */
export const PAYMENT_METHODS = ['MP01', 'MP02', 'MP05', 'MP08', 'MP12', 'MP19'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

/**
 * Bank transfer: the invoice shows where to pay.
 */
export const BANK_TRANSFER: PaymentMethod = 'MP05'

/**
 * The Invoice record types Payments are recorded on: Invoices and Legacy
 * Invoices (#27); never a Credit Note (a refund it calls for is a negative
 * Payment on the Invoice it credits, ADR 0014).
 */
export const PAYABLE_DOCUMENT_TYPES = ['invoice', 'legacy'] as const
