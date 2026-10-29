import { test } from '@japa/runner'
import Big from 'big.js'
import { buildFatturaPA, latin1, legalReferences, type FatturaInput } from '#fiscal/fattura_pa'
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
  deduction?: boolean
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
    deduction: line.deduction,
  }))
  return {
    progressive: '0000A',
    documentType: 'TD01',
    number: '12/2026',
    issuedOn: '2026-10-28',
    dueOn: '2026-11-30',
    paymentMethod: 'MP05',
    credits: null,
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

  test('an Advance Invoice is TD02', async ({ assert }) => {
    const xml = buildFatturaPA(
      input([{ quantity: '1', unitPrice: '300', vatRate: '22' }], { documentType: 'TD02' })
    )

    assert.deepEqual(await fatturaSchemaErrors(xml), [])
    assert.deepEqual(tag(xml, 'TipoDocumento'), ['TD02'])
  })

  test('a Credit Note is TD04, refers to the Invoice it credits and has no payment', async ({
    assert,
  }) => {
    const xml = buildFatturaPA(
      input([{ quantity: '1', unitPrice: '40', vatRate: '22' }], {
        documentType: 'TD04',
        number: 'NC3/2026',
        dueOn: null,
        paymentMethod: null,
        credits: { number: '12/2026', issuedOn: '2026-10-01' },
      })
    )

    assert.deepEqual(await fatturaSchemaErrors(xml), [])
    assertSummaryAddsUp(xml, assert)
    assert.deepEqual(tag(xml, 'TipoDocumento'), ['TD04'])
    assert.deepEqual(tag(xml, 'Numero'), ['NC3/2026'])
    // Amounts are positive: TD04 itself says they are credited
    assert.deepEqual(tag(xml, 'ImportoTotaleDocumento'), ['48.80'])
    const linked = tag(xml, 'DatiFattureCollegate')
    assert.lengthOf(linked, 1)
    assert.deepEqual(tag(linked[0], 'IdDocumento'), ['12/2026'])
    assert.deepEqual(tag(linked[0], 'Data'), ['2026-10-01'])
    // After DatiGeneraliDocumento, inside DatiGenerali, as the schema orders them
    assert.isBelow(xml.indexOf('</DatiGeneraliDocumento>'), xml.indexOf('<DatiFattureCollegate>'))
    assert.notInclude(xml, '<DatiPagamento>')
  })

  test('the final Invoice takes an advance back with a negative line', async ({ assert }) => {
    const xml = buildFatturaPA(
      input(
        [
          { quantity: '1', unitPrice: '1000', vatRate: '22' },
          {
            description: 'Detrazione acconto fattura 3/2026 del 01/10/2026',
            quantity: '1',
            unitPrice: '-300',
            vatRate: '22',
            deduction: true,
          },
        ],
        {},
        '10'
      )
    )

    assert.deepEqual(await fatturaSchemaErrors(xml), [])
    assertSummaryAddsUp(xml, assert)
    // 1000 less 10% = 900, less the 300 advance = 600, plus 22% VAT
    assert.deepEqual(tag(xml, 'ImportoTotaleDocumento'), ['732.00'])
  })

  test('an advance taken back at a rate the work does not use: a negative row', async ({
    assert,
  }) => {
    const xml = buildFatturaPA(
      input(
        [
          { quantity: '1', unitPrice: '1000', vatRate: '10' },
          {
            description: 'Detrazione acconto',
            quantity: '1',
            unitPrice: '-300',
            vatRate: '22',
            deduction: true,
          },
        ],
        {},
        '10'
      )
    )

    assert.deepEqual(await fatturaSchemaErrors(xml), [])
    assertSummaryAddsUp(xml, assert)
    assert.deepEqual(tag(xml, 'ImponibileImporto'), ['-300.00', '900.00'])
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

  test("a VAT row's notes stay within 100 characters, and none is lost", async ({ assert }) => {
    const exempt = "Operazione esente ai sensi dell'art. 10, comma 1, n. 18, DPR 633/1972"
    const medical = 'Prestazione sanitaria esente, art. 10 n. 18 DPR 633/72'
    const short = 'Art. 10 DPR 633/72'
    const xml = buildFatturaPA(
      input(
        [exempt, medical, short, exempt].map((legalNote) => ({
          quantity: '1',
          unitPrice: '50',
          vatRate: '0',
          natura: 'N4',
          legalNote,
        })),
        { notes: 'Grazie.' }
      )
    )

    assert.deepEqual(await fatturaSchemaErrors(xml), [])
    assertSummaryAddsUp(xml, assert)
    // The notes that fit whole, in line order; the one that doesn't moves to Causale
    assert.deepEqual(tag(xml, 'RiferimentoNormativo'), [`${exempt}; ${short}`])
    assert.deepEqual(tag(xml, 'Causale'), ['Grazie.', medical])
  })

  test('legal references: a note over 100 characters is cut but also kept whole', ({ assert }) => {
    const long = 'Nota salvata prima del limite di cento caratteri, '.repeat(3).trim()
    assert.deepEqual(legalReferences([long, 'Art. 10']), {
      reference: 'Art. 10',
      overflow: [long],
    })
    assert.deepEqual(legalReferences([long]), {
      reference: long.slice(0, 100),
      overflow: [long],
    })
    assert.deepEqual(legalReferences([]), { reference: null, overflow: [] })
    assert.deepEqual(legalReferences(['x'.repeat(48), 'y'.repeat(50)]), {
      reference: `${'x'.repeat(48)}; ${'y'.repeat(50)}`,
      overflow: [],
    })
  })

  test('a note over 100 characters: cut in the row, whole in Causale', async ({ assert }) => {
    const long = `Operazione esente ${'secondo la normativa vigente, '.repeat(5)}art. 10 DPR 633/1972`
    const xml = buildFatturaPA(
      input([{ quantity: '1', unitPrice: '80', vatRate: '0', natura: 'N4', legalNote: long }])
    )

    assert.deepEqual(await fatturaSchemaErrors(xml), [])
    assert.isAbove(long.length, 100)
    assert.deepEqual(tag(xml, 'RiferimentoNormativo'), [long.slice(0, 100)])
    assert.deepEqual(tag(xml, 'Causale'), [long])
  })

  test('a note over 200 characters that does not fit runs over several Causale', async ({
    assert,
  }) => {
    const long = `Nota storica: ${'operazione non imponibile per legge, '.repeat(12)}fine`
    const xml = buildFatturaPA(
      input(
        ['Art. 10 DPR 633/72', long].map((legalNote) => ({
          quantity: '1',
          unitPrice: '40',
          vatRate: '0',
          natura: 'N4',
          legalNote,
        }))
      )
    )

    assert.deepEqual(await fatturaSchemaErrors(xml), [])
    assert.deepEqual(tag(xml, 'RiferimentoNormativo'), ['Art. 10 DPR 633/72'])
    const causale = tag(xml, 'Causale')
    assert.lengthOf(causale, Math.ceil(long.length / 200))
    assert.equal(causale.join(''), long)
  })

  test('legal references: notes alike once written in Latin-1 count once', ({ assert }) => {
    assert.deepEqual(legalReferences(['Art. 10 “esente”', ' Art. 10 "esente" ']), {
      reference: 'Art. 10 "esente"',
      overflow: [],
    })
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
    // Control characters would make the XML malformed
    assert.equal(latin1('a\u0000b\u000bc\td\ne'), 'a b c\td\ne')
  })

  test('the phone drops the Italian prefix; contacts are left out when empty', async ({
    assert,
  }) => {
    const mobile = buildFatturaPA(
      input([{ quantity: '1', unitPrice: '10', vatRate: '22' }], {
        company: { ...company, phone: '+39 333 1234567', email: null },
      })
    )
    assert.deepEqual(tag(mobile, 'Telefono'), ['3331234567'])
    assert.deepEqual(await fatturaSchemaErrors(mobile), [])

    const none = buildFatturaPA(
      input([{ quantity: '1', unitPrice: '10', vatRate: '22' }], {
        company: { ...company, phone: null, email: null },
      })
    )
    assert.notInclude(none, '<Contatti>')
    assert.deepEqual(await fatturaSchemaErrors(none), [])
  })
})
