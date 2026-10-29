import { test } from '@japa/runner'
import { chargeSummary, visitProgress, type SummaryCharge } from '#services/job_summary'

test.group('Visit progress', () => {
  test('counts done Visits of those not cancelled, and the next one to do', ({ assert }) => {
    const visits = [
      { id: 1, status: 'done', startsAt: '2026-10-01T09:00' },
      { id: 2, status: 'needs_return', startsAt: '2026-10-02T09:00' },
      { id: 3, status: 'cancelled', startsAt: '2026-10-03T09:00' },
      { id: 5, status: 'planned', startsAt: '2026-10-12T09:00' },
      { id: 4, status: 'in_progress', startsAt: '2026-10-05T09:00' },
    ]
    const progress = visitProgress(visits)
    assert.deepInclude(progress, { done: 2, total: 4, cancelled: 1 })
    assert.equal(progress.next?.id, 4)
  })

  test('no next Visit once none is open', ({ assert }) => {
    const progress = visitProgress([
      { status: 'done', startsAt: '2026-10-01T09:00' },
      { status: 'cancelled', startsAt: '2026-10-09T09:00' },
    ])
    assert.deepEqual(progress, { done: 1, total: 1, cancelled: 1, next: null })
    assert.deepEqual(visitProgress([]), { done: 0, total: 0, cancelled: 0, next: null })
  })
})

test.group('Charges summary', () => {
  const hours = (
    visitId: number | null,
    worker: string | null,
    quantity: string,
    work: SummaryCharge['work'],
    labourRateId = 1
  ): SummaryCharge => ({
    kind: 'labour',
    visitId,
    worker,
    labourRateId,
    labourRate: `Tariffa ${labourRateId}`,
    quantity,
    work,
  })
  const valves = (
    visitId: number | null,
    quantity: string,
    work: SummaryCharge['work']
  ): SummaryCharge => ({
    kind: 'item',
    visitId,
    itemId: 7,
    item: 'Valvola',
    unit: 'pz',
    quantity,
    work,
  })

  test('hours per worker and Labour Rate, by work state', ({ assert }) => {
    const { hours: rows } = chargeSummary(
      [
        hours(10, 'Anna', '2', 'done'),
        hours(11, 'Anna', '1.5', 'done'),
        hours(12, 'Anna', '3', 'planned'),
        hours(10, 'Anna', '1', 'done', 2),
        hours(10, 'Bruno', '2', 'not_done'),
        hours(null, 'Ditta Rossi', '8', 'planned'),
      ],
      [10, 11, 12]
    )
    assert.deepEqual(
      rows.map(({ worker, labourRate, planned, done, notDone }) => [
        worker,
        labourRate,
        planned,
        done,
        notDone,
      ]),
      [
        ['Anna', 'Tariffa 1', '3', '3.5', '0'],
        ['Anna', 'Tariffa 2', '0', '1', '0'],
        ['Bruno', 'Tariffa 1', '0', '0', '2'],
        ['Ditta Rossi', 'Tariffa 1', '8', '0', '0'],
      ]
    )
  })

  test('Items planned, used and not done, with the Job first and then the Visits in order', ({
    assert,
  }) => {
    const { items, hours: rows } = chargeSummary(
      [
        valves(12, '2', 'planned'),
        valves(10, '3', 'done'),
        valves(10, '1', 'not_done'),
        valves(null, '10', 'planned'),
        valves(11, '4', 'not_done'),
        { kind: 'other', visitId: null, quantity: '1', work: 'done' },
      ],
      [10, 11, 12]
    )
    assert.lengthOf(rows, 0)
    assert.deepEqual(items, [
      {
        itemId: 7,
        item: 'Valvola',
        unit: 'pz',
        planned: '12',
        done: '3',
        notDone: '5',
        visits: [
          { visitId: null, planned: '10', done: '0', notDone: '0' },
          { visitId: 10, planned: '0', done: '3', notDone: '1' },
          { visitId: 11, planned: '0', done: '0', notDone: '4' },
          { visitId: 12, planned: '2', done: '0', notDone: '0' },
        ],
      },
    ])
  })
})
