/**
 * Registro Imprese codes (FatturaPA IscrizioneREA): one shareholder or
 * several, and whether the company is in liquidation.
 */
export const SOLE_SHAREHOLDER = ['SU', 'SM'] as const
export type SoleShareholder = (typeof SOLE_SHAREHOLDER)[number]

export const LIQUIDATION_STATUSES = ['LN', 'LS'] as const
export type LiquidationStatus = (typeof LIQUIDATION_STATUSES)[number]

/** Not in liquidation */
export const DEFAULT_LIQUIDATION_STATUS: LiquidationStatus = 'LN'
