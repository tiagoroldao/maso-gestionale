/**
 * A Quote's life (ADR 0013): a draft is edited freely; once sent it is
 * frozen, then accepted or declined. A draft decided on the spot is sent
 * at that moment.
 */
export const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'declined'] as const
export type QuoteStatus = (typeof QUOTE_STATUSES)[number]
