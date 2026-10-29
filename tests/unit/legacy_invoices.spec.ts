import { test } from '@japa/runner'
import { legacyAmountsRefusal, legacyCreditRefusal, legacyRowVat } from '#shared/legacy_invoices'
import { creditRefusal } from '#shared/credit_notes'

const advance = (overrides: Partial<Parameters<typeof legacyAmountsRefusal>[0]> = {}) => ({
  jobId: 1,
  advance: true,
  taxable: '700.00',
  vat: '130.00',
  total: '830.00',
  vatRows: [
    { vatRate: '22.00', natura: null, taxable: '500.00' },
    { vatRate: '10.00', natura: null, taxable: '200.00' },
  ],
  ...overrides,
})

test.group('Legacy Invoices', () => {
  test('a row’s VAT is worked out at its rate, half-up to the cent', ({ assert }) => {
    assert.equal(legacyRowVat({ vatRate: '22', taxable: '100' }), '22.00')
    assert.equal(legacyRowVat({ vatRate: '22', taxable: '0.25' }), '0.06')
    assert.equal(legacyRowVat({ vatRate: '0', taxable: '80' }), '0.00')
  })

  test('an advance’s rows add up to what is printed', ({ assert }) => {
    assert.isNull(legacyAmountsRefusal(advance()))
    assert.equal(legacyAmountsRefusal(advance({ jobId: null })), 'advanceWithoutJob')
    assert.equal(legacyAmountsRefusal(advance({ vatRows: [] })), 'noVatRows')
    assert.equal(
      legacyAmountsRefusal(
        advance({
          vatRows: [
            { vatRate: '22.00', natura: null, taxable: '500.00' },
            { vatRate: '22', natura: null, taxable: '200.00' },
          ],
        })
      ),
      'duplicateVatRow'
    )
    // A 0% row with another Natura is another row
    assert.notEqual(
      legacyAmountsRefusal(
        advance({
          vatRows: [
            { vatRate: '0', natura: 'N2.2', taxable: '500.00' },
            { vatRate: '0', natura: 'N4', taxable: '200.00' },
          ],
        })
      ),
      'duplicateVatRow'
    )
    assert.equal(legacyAmountsRefusal(advance({ taxable: '701.00' })), 'rowsTaxable')
    assert.equal(legacyAmountsRefusal(advance({ vat: '130.01' })), 'rowsVat')
    assert.equal(legacyAmountsRefusal(advance({ total: '832.00' })), 'advanceTotal')
  })

  test('not an advance: the totals stay as printed', ({ assert }) => {
    assert.isNull(
      legacyAmountsRefusal(advance({ advance: false, jobId: null, vatRows: [], total: '832.00' }))
    )
  })

  test('a Legacy Invoice can be credited (it is issued)', ({ assert }) => {
    assert.isNull(creditRefusal({ documentType: 'legacy', status: 'delivered' }))
    assert.isNull(creditRefusal({ documentType: 'invoice', status: 'delivered' }))
  })

  test('a Credit Note credits a Legacy Invoice by amounts', ({ assert }) => {
    const line = (vatRate: string, amount: string) => ({
      vatRate,
      natura: null,
      unitPrice: amount,
      lineTotal: amount,
    })
    const rows = [
      { vatRate: '22.00', natura: null, taxable: '500.00' },
      { vatRate: '10.00', natura: null, taxable: '200.00' },
    ]
    const taken = [{ vatRate: '22', natura: null, taxable: '100.00' }]
    // An advance: by VAT row, with what was taken back at each
    assert.isNull(legacyCreditRefusal({ rows, taxable: '700', lines: [line('22', '400')], taken }))
    assert.equal(
      legacyCreditRefusal({ rows, taxable: '700', lines: [line('22', '400.01')], taken }),
      'lineCreditTooLarge'
    )
    assert.equal(
      legacyCreditRefusal({ rows, taxable: '700', lines: [line('4', '1')], taken }),
      'legacyVatRow'
    )
    assert.equal(
      legacyCreditRefusal({ rows, taxable: '700', lines: [line('10', '-1')], taken: [] }),
      'negativeCredit'
    )
    // Otherwise: within the printed taxable, at any VAT
    assert.isNull(
      legacyCreditRefusal({ rows: null, taxable: '100', lines: [line('4', '60')], taken: [] })
    )
    assert.equal(
      legacyCreditRefusal({ rows: null, taxable: '100', lines: [line('4', '60')], taken }),
      'lineCreditTooLarge'
    )
  })
})
