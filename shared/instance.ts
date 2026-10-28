/**
 * How finalised Invoices reach SDI (ADR 0004): uploaded by hand, or sent
 * through Invoicetronic (#92).
 */
export const SDI_MODES = ['manual', 'invoicetronic'] as const
export type SdiMode = (typeof SDI_MODES)[number]
