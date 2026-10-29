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

/**
 * The longest legal note a VAT Code can carry: FatturaPA's
 * RiferimentoNormativo takes 100 characters, so a longer one would be cut
 * in the XML.
 */
export const LEGAL_NOTE_MAX = 100

/**
 * What a line bills, for the default VAT rules (#26): labour (and the
 * call-out fee), material, or a significant good (_bene significativo_,
 * whose value above the labour is taxed at 22% under a 10% rule).
 */
export const LINE_KINDS = ['labour', 'material', 'significant_good'] as const
export type LineKind = (typeof LINE_KINDS)[number]

/**
 * A line's kind: labour unless it bills an Item.
 */
export function lineKindOf(item: { significantGood: boolean } | null | undefined): LineKind {
  if (!item) return 'labour'
  return item.significantGood ? 'significant_good' : 'material'
}

/**
 * A significant good on a 10% line: only up to the value of the rest of
 * the work is at 10%; above it the 22% rate applies (the split is still
 * done by hand, #58).
 */
export function needsSignificantGoodSplit(
  code: { rate: string; natura: string | null },
  significantGood: boolean
) {
  return significantGood && !code.natura && Number(code.rate) === 10
}

/**
 * The saved line whose VAT treatment (rate, Natura, legal note) a line
 * keeps: its own as saved, while its VAT Code is still the one it was
 * saved with; null when the code's current treatment applies (a new
 * line, or one whose code changed). So editing a code in settings
 * doesn't rewrite a draft's lines (#94, ADR 0008), on the server and on
 * the page alike.
 */
export function keptVatTreatment<T extends { vatCodeId: number }>(
  saved: T | null | undefined,
  vatCodeId: number
): T | null {
  return saved && saved.vatCodeId === vatCodeId ? saved : null
}
