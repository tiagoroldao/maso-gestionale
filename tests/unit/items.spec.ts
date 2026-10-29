import { test } from '@japa/runner'
import { equipmentUnits, isWholeQuantity, itemFlagDefaults, takesSerialNumber } from '#shared/items'

test.group('Item flags (#176)', () => {
  test('Equipment with a maintenance interval; Groupable unless Equipment or significant', ({
    assert,
  }) => {
    const cases = [
      [null, false, { equipment: false, groupable: true }],
      [null, true, { equipment: false, groupable: false }],
      [12, false, { equipment: true, groupable: false }],
      [12, true, { equipment: true, groupable: false }],
    ] as const
    for (const [maintenanceIntervalMonths, significantGood, expected] of cases) {
      assert.deepEqual(itemFlagDefaults({ maintenanceIntervalMonths, significantGood }), expected)
    }
  })

  test('an Equipment Charge counts whole pieces, a serial number for one only', ({ assert }) => {
    assert.deepEqual(['1', '3', '3.000', '1.5', '0.25'].map(isWholeQuantity), [
      true,
      true,
      true,
      false,
      false,
    ])
    assert.deepEqual(['1', '3.000', '2.5', '0.5'].map(equipmentUnits), [1, 3, 2, 1])
    assert.deepEqual(['1', '1.000', '2', '0.5'].map(takesSerialNumber), [true, true, false, false])
  })
})
