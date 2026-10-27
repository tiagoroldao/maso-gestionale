/**
 * FatturaPA RegimeFiscale codes (RF03 no longer exists).
 */
export const TAX_REGIMES = {
  RF01: 'Ordinario',
  RF02: 'Contribuenti minimi',
  RF04: 'Agricoltura e attività connesse e pesca',
  RF05: 'Vendita sali e tabacchi',
  RF06: 'Commercio fiammiferi',
  RF07: 'Editoria',
  RF08: 'Gestione servizi telefonia pubblica',
  RF09: 'Rivendita documenti di trasporto pubblico e di sosta',
  RF10: 'Intrattenimenti, giochi e altre attività',
  RF11: 'Agenzie viaggi e turismo',
  RF12: 'Agriturismo',
  RF13: 'Vendite a domicilio',
  RF14: 'Rivendita beni usati, oggetti d’arte, d’antiquariato o da collezione',
  RF15: 'Agenzie di vendite all’asta di oggetti d’arte, antiquariato o da collezione',
  RF16: 'IVA per cassa P.A.',
  RF17: 'IVA per cassa',
  RF18: 'Altro',
  RF19: 'Regime forfettario',
} as const

export type TaxRegime = keyof typeof TAX_REGIMES
