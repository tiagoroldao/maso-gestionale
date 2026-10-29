import { test } from '@japa/runner'
import {
  inPeriod,
  parseWorkReportOptions,
  workReportTable,
  type WorkReportCharge,
  type WorkReportLabels,
} from '#shared/work_report'
import { formatMoney } from '#shared/money'

const labels: WorkReportLabels = {
  date: 'Data',
  technicians: 'Tecnici',
  description: 'Descrizione',
  quantity: 'Quantità',
  unitPrice: 'Prezzo',
  amount: 'Importo',
  notes: 'Note',
  notBilled: 'Non addebitato',
  total: 'Totale',
}

const hours = (quantity: string, overrides: Partial<WorkReportCharge> = {}): WorkReportCharge => ({
  group: 'labour:1',
  description: 'Idraulico',
  unit: 'h',
  quantity,
  unitPrice: '40.0000',
  amount: (Number(quantity) * 40).toFixed(2),
  ...overrides,
})
const valves = (quantity: string, overrides: Partial<WorkReportCharge> = {}) =>
  hours(quantity, {
    group: 'item:7',
    description: 'Valvola',
    unit: 'pz',
    unitPrice: '7.5000',
    amount: (Number(quantity) * 7.5).toFixed(2),
    ...overrides,
  })

test.group('Work report table (#180)', () => {
  test('a row per line of each Visit, day and Technicians on its first', ({ assert }) => {
    const table = workReportTable(
      [
        {
          day: '2026-10-20',
          technicians: ['Anna', 'Bruno'],
          // Two people's hours at one Labour Rate make one line
          charges: [hours('2'), valves('3'), hours('1.5')],
          notes: ['Valvola sostituita'],
        },
        { day: '2026-10-22', technicians: ['Anna'], charges: [], notes: [] },
      ],
      { prices: false, notes: false },
      labels
    )

    assert.deepEqual(table, {
      headers: ['Data', 'Tecnici', 'Descrizione', 'Quantità'],
      rows: [
        ['20/10/2026', 'Anna, Bruno', 'Idraulico', '3,5 h'],
        ['', '', 'Valvola', '3 pz'],
        // A Visit with nothing recorded still has its day
        ['22/10/2026', 'Anna', '', ''],
      ],
    })
  })

  test('with prices: unit price, amount billed, not billed lines apart, and the total', ({
    assert,
  }) => {
    const table = workReportTable(
      [
        {
          day: '2026-10-20',
          technicians: ['Anna'],
          charges: [
            hours('2'),
            hours('1', { amount: null }),
            hours('1', { unitPrice: '50.0000', amount: '50.00' }),
            valves('2'),
          ],
          notes: ['Valvola sostituita', 'Impianto in pressione'],
        },
      ],
      { prices: true, notes: true },
      labels
    )

    assert.deepEqual(table.headers, [
      'Data',
      'Tecnici',
      'Descrizione',
      'Quantità',
      'Prezzo',
      'Importo',
    ])
    assert.deepEqual(table.rows, [
      ['20/10/2026', 'Anna', 'Idraulico', '2 h', formatMoney('40'), formatMoney('80')],
      ['', '', 'Idraulico', '1 h', formatMoney('40'), 'Non addebitato'],
      ['', '', 'Idraulico', '1 h', formatMoney('50'), formatMoney('50')],
      ['', '', 'Valvola', '2 pz', formatMoney('7.5'), formatMoney('15')],
      ['', '', 'Note: Valvola sostituita / Impianto in pressione', '', '', ''],
      ['', '', 'Totale', '', '', formatMoney('145')],
    ])
  })

  test('an empty report prints its headers, and a zero total with prices', ({ assert }) => {
    assert.deepEqual(workReportTable([], { prices: true, notes: true }, labels).rows, [
      ['', '', 'Totale', '', '', formatMoney('0')],
    ])
    assert.deepEqual(workReportTable([], { prices: false, notes: true }, labels).rows, [])
  })
})

test.group('Work report options (#180)', () => {
  test('dates are ISO days or open, choices booleans', ({ assert }) => {
    assert.deepEqual(
      parseWorkReportOptions({ from: '2026-10-01', to: '', prices: true, notes: false }),
      { from: '2026-10-01', to: null, prices: true, notes: false }
    )
    assert.deepEqual(parseWorkReportOptions({ from: null, prices: false, notes: false }), {
      from: null,
      to: null,
      prices: false,
      notes: false,
    })
    for (const refused of [
      null,
      'all',
      [],
      { from: '2026-02-30', to: null, prices: false, notes: false },
      { from: '01/10/2026', to: null, prices: false, notes: false },
      { from: null, to: null, prices: 'yes', notes: false },
      { from: null, to: null, prices: false },
    ]) {
      assert.isNull(parseWorkReportOptions(refused), JSON.stringify(refused))
    }
  })

  test('a period includes both ends; an open end has no limit', ({ assert }) => {
    const october = { from: '2026-10-01', to: '2026-10-31' }
    assert.isTrue(inPeriod('2026-10-01', october))
    assert.isTrue(inPeriod('2026-10-31', october))
    assert.isFalse(inPeriod('2026-11-01', october))
    assert.isTrue(inPeriod('2020-01-01', { from: null, to: '2026-10-31' }))
    assert.isTrue(inPeriod('2030-01-01', { from: null, to: null }))
  })
})
