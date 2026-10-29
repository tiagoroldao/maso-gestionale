import { test } from '@japa/runner'
import {
  inSectionOrder,
  organiseCharges,
  sectionRuns,
  type OrganisableCharge,
} from '#shared/invoice_sections'

type Charge = OrganisableCharge & { id: string }

type On = { visitId: number | null; day: string | null; time: string | null }
const visit1: On = { visitId: 1, day: '2026-10-05', time: '09:00' }
const visit2: On = { visitId: 2, day: '2026-10-12', time: '09:00' }
const onJob: On = { visitId: null, day: null, time: null }
const hours = (id: string, on = visit1): Charge => ({
  id,
  kind: 'labour',
  equipment: false,
  category: null,
  ...on,
})
const item = (
  id: string,
  { equipment = false, category = null as { id: number; name: string } | null, on = visit1 } = {}
): Charge => ({ id, kind: 'item', equipment, category, ...on })
const other = (id: string, on: On = onJob): Charge => ({
  id,
  kind: 'other',
  equipment: false,
  category: null,
  ...on,
})

const layout = (groups: { heading: unknown; charges: Charge[] }[]) =>
  groups.map((group) => [group.heading, group.charges.map((charge) => charge.id)])

const valves = { id: 7, name: 'Valvole' }
const boilers = { id: 3, name: 'Caldaie' }
// In the order their work happened: two Visits, then the Job's own
const work = [
  hours('h1'),
  item('valve1', { category: valves }),
  item('boiler', { equipment: true, category: boilers }),
  item('pipe'),
  other('callout1', visit1),
  hours('h2', visit2),
  item('valve2', { category: valves, on: visit2 }),
  other('callout2'),
]

test.group('organiseCharges', () => {
  test('by kind: Manodopera, Materiali, Apparecchi, Altro, each in work order', ({ assert }) => {
    assert.deepEqual(layout(organiseCharges(work, 'kind')), [
      [{ type: 'kind', kind: 'labour' }, ['h1', 'h2']],
      [{ type: 'kind', kind: 'materials' }, ['valve1', 'pipe', 'valve2']],
      [{ type: 'kind', kind: 'equipment' }, ['boiler']],
      [{ type: 'kind', kind: 'other' }, ['callout1', 'callout2']],
    ])
  })

  test('by kind leaves out the kinds with nothing', ({ assert }) => {
    assert.deepEqual(layout(organiseCharges([other('c'), hours('h')], 'kind')), [
      [{ type: 'kind', kind: 'labour' }, ['h']],
      [{ type: 'kind', kind: 'other' }, ['c']],
    ])
  })

  test('by category: Manodopera, the categories by name, then Altro', ({ assert }) => {
    assert.deepEqual(layout(organiseCharges(work, 'category')), [
      [{ type: 'kind', kind: 'labour' }, ['h1', 'h2']],
      [{ type: 'category', name: 'Caldaie' }, ['boiler']],
      [{ type: 'category', name: 'Valvole' }, ['valve1', 'valve2']],
      [{ type: 'kind', kind: 'other' }, ['pipe', 'callout1', 'callout2']],
    ])
  })

  test("by Visit: each Visit in work order, then the Job's own", ({ assert }) => {
    assert.deepEqual(layout(organiseCharges(work, 'visit')), [
      [
        { type: 'visit', visitId: 1, day: '2026-10-05', time: '09:00' },
        ['h1', 'valve1', 'boiler', 'pipe', 'callout1'],
      ],
      [{ type: 'visit', visitId: 2, day: '2026-10-12', time: '09:00' }, ['h2', 'valve2']],
      [{ type: 'job' }, ['callout2']],
    ])
  })

  test('by Visit: two Visits on one day are two sections', ({ assert }) => {
    const afternoon: On = { visitId: 3, day: '2026-10-05', time: '14:00' }
    assert.deepEqual(layout(organiseCharges([hours('h1'), hours('h3', afternoon)], 'visit')), [
      [{ type: 'visit', visitId: 1, day: '2026-10-05', time: '09:00' }, ['h1']],
      [{ type: 'visit', visitId: 3, day: '2026-10-05', time: '14:00' }, ['h3']],
    ])
  })

  test('none: one group without a heading; nothing gives no group', ({ assert }) => {
    assert.deepEqual(layout(organiseCharges(work, 'none')), [
      [null, work.map((charge) => charge.id)],
    ])
    assert.deepEqual(organiseCharges([], 'kind'), [])
    assert.deepEqual(organiseCharges([], 'none'), [])
  })
})

test.group('inSectionOrder', () => {
  test('outside any section first, then by section, deductions last; stable within', ({
    assert,
  }) => {
    const lines = [
      { id: 'a', rank: 1, deduction: false },
      { id: 'deduction', rank: null, deduction: true },
      { id: 'b', rank: 0, deduction: false },
      { id: 'outside1', rank: null, deduction: false },
      { id: 'c', rank: 1, deduction: false },
      { id: 'outside2', rank: null, deduction: false },
    ]
    assert.deepEqual(
      inSectionOrder(
        lines,
        (line) => line.rank,
        (line) => line.deduction
      ).map((line) => line.id),
      ['outside1', 'outside2', 'b', 'a', 'c', 'deduction']
    )
  })
})

test.group('sectionRuns', () => {
  test("runs of the same section, each with its lines' amounts added up", ({ assert }) => {
    const runs = sectionRuns([
      { sectionId: null, lineTotal: '5.00' },
      { sectionId: 4, lineTotal: '10.50' },
      { sectionId: 4, lineTotal: '0.25' },
      { sectionId: 9, lineTotal: '100.00' },
      { sectionId: null, lineTotal: '-20.00' },
    ])
    assert.deepEqual(
      runs.map((run) => [run.sectionId, run.lines.length, run.subtotal]),
      [
        [null, 1, '5.00'],
        [4, 2, '10.75'],
        [9, 1, '100.00'],
        [null, 1, '-20.00'],
      ]
    )
  })
})
