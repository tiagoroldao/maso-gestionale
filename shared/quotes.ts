/**
 * A Quote's life (ADR 0013): a draft is edited freely; once sent it is
 * frozen, then accepted or declined. A draft decided on the spot, accepted
 * or declined, is sent at that moment.
 */
export const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'declined'] as const
export type QuoteStatus = (typeof QUOTE_STATUSES)[number]

/**
 * How many days a Quote may stay valid (also a DB check on quotes).
 */
export const QUOTE_VALIDITY_DAYS = { min: 1, max: 365 } as const

/**
 * A Quote's number, from its Job's: "2026/0007-2" for the Job's second.
 */
export function quoteNumber(jobNumber: string, sequence: number) {
  return `${jobNumber}-${sequence}`
}
