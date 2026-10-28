/**
 * How an Invoice number is written (FatturaPA Numero, PDF, lists): the
 * yearly sequence number and the year, "12/2026".
 */
export function formatInvoiceNumber(number: number, year: number) {
  return `${number}/${year}`
}
