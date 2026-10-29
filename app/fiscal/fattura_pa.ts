import Big from 'big.js'
import type Invoice from '#models/invoice'
import type { CompanySnapshot, CustomerSnapshot } from '#models/invoice'
import type { InvoiceTotals } from '#shared/invoice_totals'
import type { PaymentMethod } from '#shared/payments'
import { BANK_TRANSFER } from '#shared/payments'

/**
 * Everything a FatturaPA document needs, taken from a finalised Invoice and
 * the copies made when it was finalised. Amounts are decimal strings.
 */
export type FatturaInput = {
  /** Unique per file sent; also the file name's suffix */
  progressive: string
  /** TD01 an invoice, TD02 an Advance Invoice (acconto), TD04 a Credit Note */
  documentType: 'TD01' | 'TD02' | 'TD04'
  number: string
  issuedOn: string
  /** Nothing is paid on a Credit Note: no DatiPagamento */
  dueOn: string | null
  paymentMethod: PaymentMethod | null
  /** The Invoice a Credit Note credits (DatiFattureCollegate) */
  credits: { number: string; issuedOn: string } | null
  company: CompanySnapshot
  customer: CustomerSnapshot
  lines: {
    description: string
    quantity: string
    unit: string | null
    unitPrice: string
    discountPercent: string
    vatRate: string
    natura: string | null
    lineTotal: string
    legalNote: string | null
  }[]
  /** From invoiceTotals(): the global discount is split per VAT rate */
  totals: InvoiceTotals
  globalDiscountPercent: string
  /** Description of the per-rate global discount lines */
  discountLabel: string
  notes: string | null
}

const NAMESPACE = 'http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2'

/**
 * FatturaPA text fields accept Latin-1 only: common typographic characters
 * are written in plain form, anything else becomes "?".
 */
const REPLACEMENTS: Record<string, string> = {
  '–': '-',
  '—': '-',
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '…': '...',
  '€': 'EUR',
  '•': '-',
}

export function latin1(text: string) {
  return [...text]
    .map((char) => {
      const code = char.charCodeAt(0)
      // Control characters other than tab and line breaks aren't allowed in XML
      if (code < 0x20 && char !== '\t' && char !== '\n' && char !== '\r') return ' '
      return REPLACEMENTS[char] ?? (code <= 0xff ? char : '?')
    })
    .join('')
}

function escape(text: string) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

type Node = [string, Node[] | string | null | undefined]

/** Text: Latin-1, trimmed to the field's length, escaped */
const text = (value: string, max: number) => latin1(value).trim().slice(0, max)

function render(nodes: Node[], indent = '  '): string {
  return nodes
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([name, value]) =>
      Array.isArray(value)
        ? `${indent}<${name}>\n${render(value, indent + '  ')}\n${indent}</${name}>`
        : `${indent}<${name}>${escape(value as string)}</${name}>`
    )
    .join('\n')
}

/** Amounts with 2 decimals; prices and quantities keep up to 8 */
const amount = (value: string | Big) => new Big(value).toFixed(2)
const precise = (value: string | Big) => {
  const fixed = new Big(value).toFixed(8).replace(/0+$/, '')
  const [whole, decimals = ''] = fixed.split('.')
  return `${whole}.${decimals.padEnd(2, '0')}`
}

function address(party: {
  street: string
  streetNumber: string | null
  postalCode: string
  city: string
  province: string
}): Node[] {
  return [
    ['Indirizzo', text(party.street, 60)],
    ['NumeroCivico', party.streetNumber ? text(party.streetNumber, 8) : null],
    ['CAP', party.postalCode],
    ['Comune', text(party.city, 60)],
    ['Provincia', party.province],
    ['Nazione', 'IT'],
  ]
}

function seller(company: CompanySnapshot): Node[] {
  // Telefono is 5 to 12 characters: digits only, without the Italian prefix
  const phone = company.phone?.replace(/[^\d+]/g, '').replace(/^(\+|00)39/, '') ?? ''
  const contacts: Node[] = [
    ['Telefono', phone.length >= 5 && phone.length <= 12 ? phone : null],
    ['Email', company.email],
  ]
  const rea = company.rea
  return [
    [
      'DatiAnagrafici',
      [
        [
          'IdFiscaleIVA',
          [
            ['IdPaese', 'IT'],
            ['IdCodice', company.vatNumber],
          ],
        ],
        ['CodiceFiscale', company.taxCode],
        ['Anagrafica', [['Denominazione', text(company.name, 80)]]],
        ['RegimeFiscale', company.taxRegime],
      ],
    ],
    ['Sede', address(company)],
    [
      'IscrizioneREA',
      rea
        ? [
            ['Ufficio', rea.office],
            ['NumeroREA', text(rea.number, 20)],
            ['CapitaleSociale', rea.shareCapital ? amount(rea.shareCapital) : null],
            ['SocioUnico', rea.soleShareholder],
            ['StatoLiquidazione', rea.liquidationStatus],
          ]
        : null,
    ],
    ['Contatti', contacts.some(([, value]) => value) ? contacts : null],
  ]
}

function buyer(customer: CustomerSnapshot): Node[] {
  const person = customer.type === 'private'
  return [
    [
      'DatiAnagrafici',
      [
        [
          'IdFiscaleIVA',
          customer.vatNumber
            ? [
                ['IdPaese', 'IT'],
                ['IdCodice', customer.vatNumber],
              ]
            : null,
        ],
        ['CodiceFiscale', customer.taxCode],
        [
          'Anagrafica',
          person
            ? [
                ['Nome', text(customer.firstName ?? '', 60)],
                ['Cognome', text(customer.lastName ?? '', 60)],
              ]
            : [['Denominazione', text(customer.name, 80)]],
        ],
      ],
    ],
    ['Sede', address(customer)],
  ]
}

/**
 * Builds the FatturaPA XML (FPR12, private-sector) for one Invoice. The
 * global discount is written as one negative line per VAT rate, so each
 * DatiRiepilogo row's taxable amount is exactly the sum of its lines.
 */
export function buildFatturaPA(input: FatturaInput): string {
  const { company, customer, totals } = input
  const pecOnly = customer.sdiCode === '0000000' && customer.pec

  const lines: Node[] = input.lines.map((line, index) => [
    'DettaglioLinee',
    [
      ['NumeroLinea', String(index + 1)],
      ['Descrizione', text(line.description, 1000)],
      ['Quantita', precise(line.quantity)],
      ['UnitaMisura', line.unit ? text(line.unit, 10) : null],
      ['PrezzoUnitario', precise(line.unitPrice)],
      [
        'ScontoMaggiorazione',
        new Big(line.discountPercent).gt(0)
          ? [
              ['Tipo', 'SC'],
              ['Percentuale', amount(line.discountPercent)],
            ]
          : null,
      ],
      ['PrezzoTotale', amount(line.lineTotal)],
      ['AliquotaIVA', amount(line.vatRate)],
      ['Natura', line.natura],
    ],
  ])

  const discounts: Node[] = totals.summary
    // A negative row (an advance taken back) has a negative share
    .filter((row) => !new Big(row.discount).eq(0))
    .map((row, index) => [
      'DettaglioLinee',
      [
        ['NumeroLinea', String(input.lines.length + index + 1)],
        ['Descrizione', text(input.discountLabel, 1000)],
        ['PrezzoUnitario', precise(new Big(row.discount).neg())],
        ['PrezzoTotale', amount(new Big(row.discount).neg())],
        ['AliquotaIVA', amount(row.vatRate)],
        ['Natura', row.natura],
      ],
    ])

  const summary: Node[] = totals.summary.map((row) => {
    const notes = [
      ...new Set(
        input.lines
          .filter(
            (line) => new Big(line.vatRate).eq(row.vatRate) && (line.natura ?? null) === row.natura
          )
          .flatMap((line) => (line.legalNote ? [line.legalNote] : []))
      ),
    ]
    return [
      'DatiRiepilogo',
      [
        ['AliquotaIVA', amount(row.vatRate)],
        ['Natura', row.natura],
        ['ImponibileImporto', amount(row.taxable)],
        ['Imposta', amount(row.vat)],
        // Immediate VAT; rows without VAT (Natura) carry the legal reference instead
        ['EsigibilitaIVA', row.natura ? null : 'I'],
        ['RiferimentoNormativo', notes.length ? text(notes.join('; '), 100) : null],
      ],
    ]
  })

  const causale: Node[] = input.notes
    ? (text(input.notes, 5000).match(/[\s\S]{1,200}/g) ?? []).map((chunk) => ['Causale', chunk])
    : []

  const document: Node[] = [
    [
      'FatturaElettronicaHeader',
      [
        [
          'DatiTrasmissione',
          [
            [
              'IdTrasmittente',
              [
                ['IdPaese', 'IT'],
                ['IdCodice', company.taxCode ?? company.vatNumber],
              ],
            ],
            ['ProgressivoInvio', input.progressive],
            ['FormatoTrasmissione', 'FPR12'],
            ['CodiceDestinatario', customer.sdiCode],
            ['PECDestinatario', pecOnly ? customer.pec : null],
          ],
        ],
        ['CedentePrestatore', seller(company)],
        ['CessionarioCommittente', buyer(customer)],
      ],
    ],
    [
      'FatturaElettronicaBody',
      [
        [
          'DatiGenerali',
          [
            [
              'DatiGeneraliDocumento',
              [
                ['TipoDocumento', input.documentType],
                ['Divisa', 'EUR'],
                ['Data', input.issuedOn],
                ['Numero', input.number],
                ['ImportoTotaleDocumento', amount(totals.total)],
                ...causale,
              ],
            ],
            [
              'DatiFattureCollegate',
              input.credits
                ? [
                    ['IdDocumento', text(input.credits.number, 20)],
                    ['Data', input.credits.issuedOn],
                  ]
                : null,
            ],
          ],
        ],
        ['DatiBeniServizi', [...lines, ...discounts, ...summary]],
        [
          'DatiPagamento',
          input.paymentMethod && input.dueOn
            ? [
                ['CondizioniPagamento', 'TP02'],
                [
                  'DettaglioPagamento',
                  [
                    ['ModalitaPagamento', input.paymentMethod],
                    ['DataScadenzaPagamento', input.dueOn],
                    ['ImportoPagamento', amount(totals.total)],
                    [
                      'IBAN',
                      input.paymentMethod === BANK_TRANSFER && company.iban ? company.iban : null,
                    ],
                  ],
                ],
              ]
            : null,
        ],
      ],
    ],
  ]

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<p:FatturaElettronica versione="FPR12" xmlns:p="${NAMESPACE}" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`,
    render(document),
    '</p:FatturaElettronica>',
    '',
  ].join('\n')
}

/**
 * A finalised Invoice (lines preloaded; a Credit Note's credited Invoice
 * too) as the builder's input, for the Submission whose progressive it
 * carries.
 */
export function fatturaInputFor(
  invoice: Invoice,
  progressive: string,
  discountLabel: string
): FatturaInput {
  const company = invoice.companySnapshot
  const customer = invoice.customerSnapshot
  // A Legacy Invoice (#27) was issued by the previous software: never ours to send
  if (invoice.status === 'draft' || invoice.isLegacy || !company || !customer) {
    throw new Error('Only finalised Invoices have FatturaPA XML')
  }
  const credited = invoice.isCreditNote ? invoice.creditedInvoice : null
  return {
    progressive,
    documentType: invoice.isCreditNote ? 'TD04' : invoice.advance ? 'TD02' : 'TD01',
    number: invoice.formattedNumber!,
    issuedOn: invoice.issuedOn!.toISODate()!,
    dueOn: invoice.dueOn?.toISODate() ?? null,
    paymentMethod: invoice.paymentMethod,
    credits: credited
      ? { number: credited.formattedNumber!, issuedOn: credited.issuedOn!.toISODate()! }
      : null,
    company,
    customer,
    lines: invoice.lines.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      unitPrice: line.unitPrice,
      discountPercent: line.discountPercent,
      vatRate: line.vatRate,
      natura: line.natura,
      lineTotal: line.lineTotal,
      legalNote: line.legalNote,
    })),
    totals: invoice.totals,
    globalDiscountPercent: invoice.discountPercent,
    discountLabel,
    notes: invoice.notes,
  }
}

/**
 * The file name SDI expects: country, the transmitter's code, and the
 * progressive, e.g. "IT01987654322_0000A.xml".
 */
export function fatturaFileName(transmitterCode: string, progressive: string) {
  return `IT${transmitterCode}_${progressive}.xml`
}
