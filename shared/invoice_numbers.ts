import type { NumberingSeries } from './credit_notes.js'

/**
 * How an Invoice or Credit Note number is written (FatturaPA Numero, PDF,
 * lists): the yearly sequence number and the year, "12/2026"; a Credit
 * Note numbered in its own series carries its prefix, "NC12/2026".
 */
export function formatInvoiceNumber(
  number: number,
  year: number,
  series: NumberingSeries = 'invoice'
) {
  return `${series === 'credit_note' ? 'NC' : ''}${number}/${year}`
}
