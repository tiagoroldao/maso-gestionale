import { test } from '@japa/runner'
import Big from 'big.js'
import { buildFatturaPA, latin1, type FatturaInput } from '#fiscal/fattura_pa'
import { invoiceLineTotal, invoiceTotals } from '#shared/invoice_totals'
import type { CompanySnapshot, CustomerSnapshot } from '#models/invoice'
import { fatturaSchemaErrors } from '#tests/helpers/fattura_xsd'

const company: CompanySnapshot = {
  name: 'Idraulica Maso S.r.l.',
  vatNumber: '01987654322',
  taxCode: '01987654322',
  taxRegime: 'RF01',
  street: 'Via dei Mille',
  streetNumber: '12',
  postalCode: '20121',
  city: 'Milano',
  province: 'MI',
  email: 'info@maso.example',
  phone: '+39 02 1234567',
  iban: 'IT60X0542811101000000123456',
  rea: null,
}

const business: CustomerSnapshot = {
  type: 'company',
  name: 'Bar Centrale S.r.l.',
  firstName: null,
  lastName: null,
  vatNumber: '12345678903',
  taxCode: null,
  sdiCode: 'M5UXCR1',
  pec: null,
  street: 'Corso Buenos Aires',
  streetNumber: '44',
  postalCode: '20124',
  city: 'Milano',
  province: 'MI',
}

type Line = {
  description?: string
  quantity: string
  unitPrice: string
  vatRate: string
  natura?: string | null
  discountPercent?: string
  legalNote?: string | null
}

function input(lines: Line[], extra: Partial<FatturaInput> = {}, discount = '0'): FatturaInput {
  const full = lines.map((line) => ({
    description: line.description ?? 'Intervento idraulico',
    quantity: line.quantity,
    unit: 'pz',
    unitPrice: line.unitPrice,
    discountPercent: line.discountPercent ?? '0',
    vatRate: line.vatRate,
    natura: line.natura ?? null,
    lineTotal: invoiceLineTotal(line.quantity, line.unitPrice, line.discountPercent ?? '0'),
    legalNote: line.legalNote ?? null,
  }))
  return {
    progressive: '0000A',
    number: '12/2026',
    issuedOn: '2026-10-28',
    dueOn: '2026-11-30',
    paymentMethod: 'MP05',
    company,
    customer: business,
    lines: full,
    totals: invoiceTotals(full, discount),
    globalDiscountPercent: discount,
    discountLabel: `Sconto ${discount}% sul totale`,
    notes: null,
    ...extra,
  }
}

const tag = (xml: string, name: string) =>
  [...xml.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'g'))].map((m) => m[1])

/**
 * SDI rejects files whose summary doesn't add up, which the schema can't
 * see: each DatiRiepilogo's taxable amount is the sum of its lines, and
 * its tax is that amount at its rate.
 */
function assertSummaryAddsUp(xml: string, assert: { equal: Function }) {
  const lines = tag(xml, 'DettaglioLinee').map((block) => ({
    rate: tag(block, 'AliquotaIVA')[0],
    natura: tag(block, 'Natura')[0] ?? null,
    total: tag(block, 'PrezzoTotale')[0],
  }))
  for (const row of tag(xml, 'DatiRiepilogo')) {
    const rate = tag(row, 'AliquotaIVA')[0]
    const natura = tag(row, 'Natura')[0] ?? null
    const sum = lines
      .filter((line) => line.rate === rate && line.natura === natura)
      .reduce((acc, line) => acc.plus(line.total), new Big(0))
    const taxable = tag(row, 'ImponibileImporto')[0]
    assert.equal(sum.toFixed(2), taxable)
    assert.equal(
      new Big(taxable).times(rate).div(100).round(2, Big.roundHalfUp).toFixed(2),
      tag(row, 'Imposta')[0]
    )
  }
}

test.group('FatturaPA XML', () => {
  test('a single 22% line', async ({ assert }) => {
    const xml = buildFatturaPA(input([{ quantity: '2', unitPrice: '50', vatRate: '22' }]))

    assert.deepEqual(await fatturaSchemaErrors(xml), [])
    assertSummaryAddsUp(xml, assert)
    assert.deepEqual(tag(xml, 'ImportoTotaleDocumento'), ['122.00'])
    assert.deepEqual(tag(xml, 'Numero'), ['12/2026'])
    assert.deepEqual(tag(xml, 'ModalitaPagamento'), ['MP05'])
    assert.deepEqual(tag(xml, 'IBAN'), ['IT60X0542811101000000123456'])
    assert.deepEqual(tag(xml, 'EsigibilitaIVA'), ['I'])
  })

  test('10% residential maintenance', async ({ assert }) => {
    const xml = buildFatturaPA(input([{ quantity: '1', unitPrice: '180', vatRate: '10' }]))

    assert.deepEqual(await fatturaSchemaErrors(xml), [])
    assertSummaryAddsUp(xml, assert)
    assert.deepEqual(tag(xml, 'Imposta'), ['18.00'])
  })

  test('reverse charge: 0% with Natura and the legal reference', async ({ assert }) => {
    const note =
      "Operazione soggetta a inversione contabile ai sensi dell'art. 17, comma 6, lett. a-ter, DPR 633/1972"
    const xml = buildFatturaPA(
      input([{ quantity: '8', unitPrice: '40', vatRate: '0', natura: 'N6.7', legalNote: note }])
    )

    assert.deepEqual(await fatturaSchemaErrors(xml), [])
    assertSummaryAddsUp(xml, assert)
    assert.deepEqual(tag(xml, 'Natura'), ['N6.7', 'N6.7'])
    assert.deepEqual(tag(xml, 'EsigibilitaIVA'), [])
    assert.lengthOf(tag(xml, 'RiferimentoNormativo')[0], Math.min(note.length, 100))
    assert.deepEqual(tag(xml, 'ImportoTotaleDocumento'), ['320.00'])
  })

  test('several rates with line and global discounts', async ({ assert }) => {
    const xml = buildFatturaPA(
      input(
        [
          { quantity: '3', unitPrice: '9.99', vatRate: '22', discountPercent: '12.5' },
          { quantity: '1', unitPrice: '200', vatRate: '10' },
          { quantity: '1.5', unitPrice: '0.3333', vatRate: '4' },
        ],
        {},
        '7'
      )
    )

    assert.deepEqual(await fatturaSchemaErrors(xml), [])
    assertSummaryAddsUp(xml, assert)
    // One negative discount line per rate, after the real lines
    const discountLines = tag(xml, 'DettaglioLinee').filter((block) =>
      tag(block, 'PrezzoTotale')[0].startsWith('-')
    )
    assert.lengthOf(discountLines, 3)
    assert.deepEqual(tag(xml, 'Percentuale'), ['12.50'])
  })

  test('a private customer reached by PEC, with notes and REA', async ({ assert }) => {
    const xml = buildFatturaPA(
      input(
        [{ quantity: '1', unitPrice: '60', vatRate: '10', description: 'Rubinetto – posa €' }],
        {
          customer: {
            ...business,
            type: 'private',
            name: 'Mario Rossi',
            firstName: 'Mario',
            lastName: 'Rossi',
            vatNumber: null,
            taxCode: 'RSSMRA85T10A562S',
            sdiCode: '0000000',
            pec: 'mario.rossi@pec.example.it',
          },
          company: {
            ...company,
            rea: {
              office: 'MI',
              number: '1234567',
              shareCapital: '10000',
              soleShareholder: 'SU',
              liquidationStatus: 'LN',
            },
          },
          paymentMethod: 'MP01',
          notes: 'Pagamento alla consegna. '.repeat(12),
        }
      )
    )

    assert.deepEqual(await fatturaSchemaErrors(xml), [])
    assert.deepEqual(tag(xml, 'Nome'), ['Mario'])
    assert.deepEqual(tag(xml, 'PECDestinatario'), ['mario.rossi@pec.example.it'])
    assert.deepEqual(tag(xml, 'NumeroREA'), ['1234567'])
    assert.deepEqual(tag(xml, 'CapitaleSociale'), ['10000.00'])
    // Cash: no IBAN; long notes are split into 200-character Causale blocks
    assert.deepEqual(tag(xml, 'IBAN'), [])
    assert.isAbove(tag(xml, 'Causale').length, 1)
    assert.include(xml, '<Descrizione>Rubinetto - posa EUR</Descrizione>')
  })

  test('text is written in Latin-1, as FatturaPA requires', ({ assert }) => {
    assert.equal(latin1('Città “Nord” – 5€ … ✓'), 'Città "Nord" - 5EUR ... ?')
  })
})
