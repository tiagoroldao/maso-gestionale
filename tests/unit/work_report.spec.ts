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
  jobCharges: 'Altre voci',
  total: 'Totale',
  visitsTotal: 'Totale interventi',
}

const hours = (quantity: string, overrides: Partial<WorkReportCharge> = {}): WorkReportCharge => ({
  group: 'labour:1',
  description: 'Idraulico',
  unit: 'h',
  quantity,
  billQuantity: quantity,
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
      {
        visits: [
          {
            day: '2026-10-20',
            technicians: ['Anna', 'Bruno'],
            // Two people's hours at one Labour Rate make one line
            charges: [hours('2'), valves('3'), hours('1.5')],
            notes: ['Valvola sostituita'],
          },
          { day: '2026-10-22', technicians: ['Anna'], charges: [], notes: [] },
        ],
        jobCharges: [],
      },
      { prices: false, notes: false, jobCharges: true },
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
      {
        visits: [
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
        jobCharges: [],
      },
      { prices: true, notes: true, jobCharges: true },
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

  test('with prices a line shows the quantity billed, without them the one recorded', ({
    assert,
  }) => {
    const report = {
      visits: [
        {
          day: '2026-10-20',
          technicians: ['Anna'],
          // 3 hours recorded, 2 billed
          charges: [hours('2', { billQuantity: '1', amount: '40.00' }), hours('1')],
          notes: [],
        },
      ],
      jobCharges: [],
    }
    const options = { notes: false, jobCharges: true }

    assert.deepEqual(workReportTable(report, { ...options, prices: true }, labels).rows[0], [
      '20/10/2026',
      'Anna',
      'Idraulico',
      '2 h',
      formatMoney('40'),
      formatMoney('80'),
    ])
    assert.deepEqual(workReportTable(report, { ...options, prices: false }, labels).rows[0], [
      '20/10/2026',
      'Anna',
      'Idraulico',
      '3 h',
    ])
  })

  test('an empty report prints its headers, and a zero total with prices', ({ assert }) => {
    const empty = { visits: [], jobCharges: [] }
    const options = { notes: true, jobCharges: true }
    assert.deepEqual(workReportTable(empty, { ...options, prices: true }, labels).rows, [
      ['', '', 'Totale', '', '', formatMoney('0')],
    ])
    assert.deepEqual(workReportTable(empty, { ...options, prices: false }, labels).rows, [])
  })
})

test.group("Work report: the Job's other costs (#192)", () => {
  const callOut = (overrides: Partial<WorkReportCharge> = {}) =>
    hours('1', {
      group: 'other:call-out',
      description: 'Uscita',
      unit: '',
      unitPrice: '30.0000',
      amount: '30.00',
      ...overrides,
    })
  const report = {
    visits: [{ day: '2026-10-20', technicians: ['Anna'], charges: [hours('2')], notes: [] }],
    jobCharges: [callOut(), valves('2'), callOut({ amount: null })],
  }

  test('with prices: a section after the days, in the total', ({ assert }) => {
    const table = workReportTable(report, { prices: true, notes: false, jobCharges: true }, labels)

    assert.deepEqual(table.rows, [
      ['20/10/2026', 'Anna', 'Idraulico', '2 h', formatMoney('40'), formatMoney('80')],
      ['', '', 'Altre voci', '', '', ''],
      ['', '', 'Uscita', '1', formatMoney('30'), formatMoney('30')],
      ['', '', 'Valvola', '2 pz', formatMoney('7.5'), formatMoney('15')],
      ['', '', 'Uscita', '1', formatMoney('30'), 'Non addebitato'],
      ['', '', 'Totale', '', '', formatMoney('125')],
    ])
  })

  test('without prices: the quantities recorded, no total', ({ assert }) => {
    const table = workReportTable(report, { prices: false, notes: false, jobCharges: true }, labels)

    assert.deepEqual(table.rows, [
      ['20/10/2026', 'Anna', 'Idraulico', '2 h'],
      ['', '', 'Altre voci', ''],
      // Without prices, billed or not makes one line
      ['', '', 'Uscita', '2'],
      ['', '', 'Valvola', '2 pz'],
    ])
  })

  test('left out: no section, and the total reads as the Visits only', ({ assert }) => {
    const table = workReportTable(report, { prices: true, notes: false, jobCharges: false }, labels)

    assert.deepEqual(table.rows, [
      ['20/10/2026', 'Anna', 'Idraulico', '2 h', formatMoney('40'), formatMoney('80')],
      ['', '', 'Totale interventi', '', '', formatMoney('80')],
    ])
  })

  test('no heading when the Job has no other costs', ({ assert }) => {
    const table = workReportTable(
      { ...report, jobCharges: [] },
      { prices: false, notes: false, jobCharges: true },
      labels
    )

    assert.deepEqual(table.rows, [['20/10/2026', 'Anna', 'Idraulico', '2 h']])
  })
})

test.group('Work report options (#180)', () => {
  test('dates are ISO days or open, choices booleans', ({ assert }) => {
    assert.deepEqual(
      parseWorkReportOptions({
        from: '2026-10-01',
        to: '',
        prices: true,
        notes: false,
        jobCharges: true,
      }),
      { from: '2026-10-01', to: null, prices: true, notes: false, jobCharges: true }
    )
    // Issued before #192: no other costs; new input must say
    const before192 = { from: null, prices: false, notes: false }
    assert.deepEqual(parseWorkReportOptions(before192, { issued: true }), {
      from: null,
      to: null,
      prices: false,
      notes: false,
      jobCharges: false,
    })
    assert.isNull(parseWorkReportOptions(before192))
    for (const refused of [
      null,
      'all',
      [],
      { from: '2026-02-30', to: null, prices: false, notes: false },
      { from: '01/10/2026', to: null, prices: false, notes: false },
      { from: null, to: null, prices: 'yes', notes: false },
      { from: null, to: null, prices: false },
      { from: null, to: null, prices: false, notes: false, jobCharges: 'yes' },
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
