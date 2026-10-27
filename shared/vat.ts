/**
 * FatturaPA Natura codes: why a line carries no VAT (exempt, out of
 * scope, reverse charge…). A VAT Code at 0% always has one.
 */
export const NATURA_CODES = [
  'N1',
  'N2.1',
  'N2.2',
  'N3.1',
  'N3.2',
  'N3.3',
  'N3.4',
  'N3.5',
  'N3.6',
  'N4',
  'N5',
  'N6.1',
  'N6.2',
  'N6.3',
  'N6.4',
  'N6.5',
  'N6.6',
  'N6.7',
  'N6.8',
  'N6.9',
  'N7',
] as const
export type NaturaCode = (typeof NATURA_CODES)[number]
