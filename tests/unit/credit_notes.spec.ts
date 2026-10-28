import { test } from '@japa/runner'
import { creditedInFull, creditLeft, lineCreditRefusal } from '#shared/credit_notes'

const credit = (unitPrice: string, lineTotal = unitPrice) => ({ unitPrice, lineTotal })

test.group('Credit Note lines', () => {
  test("a line's Credit Notes never credit more than it", ({ assert }) => {
    const line = { lineTotal: '60.00', deduction: false }
    assert.isNull(lineCreditRefusal({ ...line, lines: [credit('60')], creditedByOthers: '0' }))
    assert.isNull(lineCreditRefusal({ ...line, lines: [credit('35')], creditedByOthers: '25.00' }))
    assert.equal(
      lineCreditRefusal({ ...line, lines: [credit('35.01')], creditedByOthers: '25.00' }),
      'lineCreditTooLarge'
    )
    assert.equal(
      lineCreditRefusal({ ...line, lines: [credit('30'), credit('30.01')], creditedByOthers: '0' }),
      'lineCreditTooLarge'
    )
  })

  test('a Credit Note line is never negative', ({ assert }) => {
    const line = { lineTotal: '60.00', deduction: false, creditedByOthers: '0' }
    assert.equal(lineCreditRefusal({ ...line, lines: [credit('-1')] }), 'negativeCredit')
    // A negative quantity
    assert.equal(lineCreditRefusal({ ...line, lines: [credit('5', '-5.00')] }), 'negativeCredit')
    assert.equal(
      lineCreditRefusal({ ...line, lines: [credit('10'), credit('-5')] }),
      'negativeCredit'
    )
  })

  test('a deduction is given back once, as it was', ({ assert }) => {
    const line = { lineTotal: '-100.00', deduction: true }
    assert.isNull(lineCreditRefusal({ ...line, lines: [credit('-100')], creditedByOthers: '0' }))
    assert.equal(
      lineCreditRefusal({ ...line, lines: [credit('-100')], creditedByOthers: '-100.00' }),
      'deductionGivenBack'
    )
    assert.equal(
      lineCreditRefusal({ ...line, lines: [credit('-50')], creditedByOthers: '0' }),
      'deductionGivenBack'
    )
    assert.equal(
      lineCreditRefusal({
        ...line,
        lines: [credit('-100'), credit('-100')],
        creditedByOthers: '0',
      }),
      'deductionGivenBack'
    )
  })

  test('a line is credited in full once its Credit Notes reach its amount', ({ assert }) => {
    assert.isTrue(creditedInFull('60.00', '60.00'))
    assert.isFalse(creditedInFull('60.00', '59.99'))
    // Credited by no Credit Note: not even a line of nothing
    assert.isFalse(creditedInFull('0.00', null))
    assert.isTrue(creditedInFull('0.00', '0.00'))
  })

  test("an advance's Credit Notes credit only what is still left of it", ({ assert }) => {
    assert.equal(creditLeft('122.00', '0'), '122.00')
    assert.equal(creditLeft('122.00', '24.40', '61.00'), '36.60')
  })
})
