import { test } from '@japa/runner'
import Big from 'big.js'
import { invoiceLineTotal, invoiceTotals, type TotalsLine } from '#shared/invoice_totals'

const line = (
  quantity: string,
  unitPrice: string,
  vatRate = '22',
  extra: Partial<TotalsLine> = {}
): TotalsLine => ({ quantity, unitPrice, vatRate, natura: null, ...extra })

test.group('Invoice line total', () => {
  test('quantity × price, less the line discount, rounded half-up', ({ assert }) => {
    assert.equal(invoiceLineTotal('3', '12.5'), '37.50')
    assert.equal(invoiceLineTotal('2', '10', '15'), '17.00')
    // 1.5 × 0.3333 = 0.49995 → 0.50
    assert.equal(invoiceLineTotal('1.5', '0.3333'), '0.50')
    // 3 × 9.99 × 0.875 = 26.22375 → 26.22
    assert.equal(invoiceLineTotal('3', '9.99', '12.5'), '26.22')
    // Large amounts round once: exact 1200180120.0149999997…
    assert.equal(invoiceLineTotal('60000.006', '20005.0005', '0.01'), '1200180120.01')
  })
})

test.group('Invoice totals', () => {
  test('one rate: VAT on the lines total', ({ assert }) => {
    const totals = invoiceTotals([line('2', '50'), line('1', '20.10')])

    assert.deepEqual(totals, {
      linesTotal: '120.10',
      discount: '0.00',
      taxable: '120.10',
      vat: '26.42',
      total: '146.52',
      summary: [
        {
          vatRate: '22.00',
          natura: null,
          linesTotal: '120.10',
          discount: '0.00',
          taxable: '120.10',
          vat: '26.42',
        },
      ],
    })
  })

  test('several rates and a reverse charge each get a summary row', ({ assert }) => {
    const totals = invoiceTotals([
      line('1', '100', '10'),
      line('1', '200', '22'),
      line('1', '50', '0', { natura: 'N6.7' }),
      line('2', '25', '10'),
    ])

    assert.deepEqual(
      totals.summary.map((row) => [row.vatRate, row.natura, row.taxable, row.vat]),
      [
        ['22.00', null, '200.00', '44.00'],
        ['10.00', null, '150.00', '15.00'],
        ['0.00', 'N6.7', '50.00', '0.00'],
      ]
    )
    assert.equal(totals.vat, '59.00')
    assert.equal(totals.total, '459.00')
  })

  test('codes with the same rate and Natura share a row', ({ assert }) => {
    const totals = invoiceTotals([line('1', '10', '22.00'), line('1', '5', '22')])
    assert.lengthOf(totals.summary, 1)
    assert.equal(totals.summary[0].taxable, '15.00')
  })

  test('the global discount is split across rates in proportion, before VAT', ({ assert }) => {
    // 10% of 300 = 30: 20 on the 22% row (200), 10 on the 10% row (100)
    const totals = invoiceTotals([line('1', '200', '22'), line('1', '100', '10')], '10')

    assert.deepEqual(
      totals.summary.map((row) => [row.linesTotal, row.discount, row.taxable, row.vat]),
      [
        ['200.00', '20.00', '180.00', '39.60'],
        ['100.00', '10.00', '90.00', '9.00'],
      ]
    )
    assert.equal(totals.discount, '30.00')
    assert.equal(totals.taxable, '270.00')
    assert.equal(totals.total, '318.60')
  })

  test('discount cents left by rounding go to the largest remainders', ({ assert }) => {
    // 5% of 1.00 = 0.05 over three equal rows: 0.0166… each → 0.02, 0.02, 0.01
    const totals = invoiceTotals(
      [line('1', '0.34', '22'), line('1', '0.33', '10'), line('1', '0.33', '4')],
      '5'
    )
    const shares = totals.summary.map((row) => row.discount)

    assert.equal(totals.discount, '0.05')
    assert.deepEqual(shares, ['0.02', '0.02', '0.01'])
    assert.equal(
      totals.summary.reduce((sum, row) => sum + Number(row.taxable), 0).toFixed(2),
      totals.taxable
    )
  })

  test('line and global discounts combine', ({ assert }) => {
    // 4 × 25 less 10% = 90; global 5% = 4.50; VAT 22% on 85.50 = 18.81
    const totals = invoiceTotals([line('4', '25', '22', { discountPercent: '10' })], '5')

    assert.equal(totals.linesTotal, '90.00')
    assert.equal(totals.discount, '4.50')
    assert.equal(totals.vat, '18.81')
    assert.equal(totals.total, '104.31')
  })

  test('VAT is rounded once per rate, not per line', ({ assert }) => {
    // Three lines of 0.10 at 22%: per line 0.022 → 0.02 ×3 = 0.06; per rate 0.066 → 0.07
    const totals = invoiceTotals([line('1', '0.10'), line('1', '0.10'), line('1', '0.10')])
    assert.equal(totals.vat, '0.07')
  })

  test('a deduction line reduces its VAT row, and the discount still adds up', ({ assert }) => {
    // 22%: 1000 − 300 deducted = 700; 10%: 500; 10% discount = 120 → 70 + 50
    const totals = invoiceTotals(
      [line('1', '1000'), line('1', '500', '10'), line('1', '-300')],
      '10'
    )
    assert.deepEqual(
      totals.summary.map((row) => [
        row.vatRate,
        row.linesTotal,
        row.discount,
        row.taxable,
        row.vat,
      ]),
      [
        ['22.00', '700.00', '70.00', '630.00', '138.60'],
        ['10.00', '500.00', '50.00', '450.00', '45.00'],
      ]
    )
    assert.equal(totals.total, '1263.60')
  })

  test('a negative VAT row takes a negative share of the discount, to the cent', ({ assert }) => {
    // 22%: 100.01; 10%: −40.02 (an advance larger than this rate's work)
    const totals = invoiceTotals([line('1', '100.01'), line('1', '-40.02', '10')], '3.33')
    const shares = totals.summary.map((row) => new Big(row.discount))
    assert.equal(shares[0].plus(shares[1]).toFixed(2), totals.discount)
    assert.isTrue(shares[0].gt(0))
    assert.isTrue(shares[1].lt(0))
  })

  test('an empty invoice totals zero', ({ assert }) => {
    const totals = invoiceTotals([], '10')
    assert.deepEqual(
      [totals.linesTotal, totals.discount, totals.vat, totals.total, totals.summary.length],
      ['0.00', '0.00', '0.00', '0.00', 0]
    )
  })
})
