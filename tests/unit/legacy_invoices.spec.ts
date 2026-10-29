import { test } from '@japa/runner'
import { legacyAmountsRefusal, legacyRowVat } from '#shared/legacy_invoices'
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

  test('a Legacy Invoice is never credited', ({ assert }) => {
    assert.equal(creditRefusal({ documentType: 'legacy', status: 'delivered' }), 'legacy')
    assert.isNull(creditRefusal({ documentType: 'invoice', status: 'delivered' }))
  })
})
