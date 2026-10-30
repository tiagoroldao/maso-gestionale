import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import { DateTime } from 'luxon'
import Charge from '#models/charge'
import Visit from '#models/visit'
import type { ScreenAction } from '#shared/screen_actions'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createJob } from '#tests/helpers/jobs'
import { createItem } from '#tests/helpers/items'
import { it } from '#tests/helpers/i18n'

/** The Job page's header actions (docs/ui.md "Actions"), as `name:rank` */
async function actionsOf(client: ApiClient, jobId: number, role: 'office' | 'admin' = 'office') {
  const page = await client
    .get(`/jobs/${jobId}`)
    .withInertia()
    .loginAs(await createUser(role))
  page.assertStatus(200)
  return page.inertiaProps.actions as ScreenAction[]
}
const ranked = (actions: ScreenAction[]) => actions.map((action) => `${action.name}:${action.rank}`)

test.group('Job page actions (#235)', () => {
  test('an open Job: draft first, planning a Visit beside it, the rest in "⋯"', async ({
    client,
    assert,
  }) => {
    const job = await createJob(await createCustomer())

    for (const role of ['office', 'admin'] as const) {
      const actions = await actionsOf(client, job.id, role)
      assert.deepEqual(ranked(actions), [
        'draftInvoice:primary',
        'planVisit:secondary',
        'edit:overflow',
        'newQuote:overflow',
        'newAdvance:overflow',
        'newLegacyInvoice:overflow',
        'close:overflow',
        'cancel:overflow',
      ])
      const cancel = actions.find((action) => action.name === 'cancel')!
      assert.isTrue(cancel.destructive)
      assert.equal(cancel.confirm, it('ui.jobs.cancelConfirm', { number: job.number }))
      assert.equal(cancel.href, `/jobs/${job.id}/cancel`)
      // Nothing to bill: the draft stays, disabled with its reason
      const draft = actions.find((action) => action.name === 'draftInvoice')!
      assert.equal(draft.disabledReason, it('ui.jobs.nothingToBill'))
    }
  })

  test('the draft opens once some work is billable, and waits while a draft does', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const job = await createJob(await createCustomer())
    await client
      .post(`/jobs/${job.id}/charges`)
      .form({
        description: 'Diritto di chiamata',
        quantity: '1',
        unit: '',
        unitPrice: '30',
        vatKind: 'labour',
      })
      .withCsrfToken()
      .loginAs(office)

    const draft = async () => {
      const actions = await actionsOf(client, job.id)
      return actions.find((action) => action.name === 'draftInvoice')!
    }
    const billable = await draft()
    assert.isNull(billable.disabledReason)

    await client
      .post(`/jobs/${job.id}/invoices`)
      .form({ combine: 'true', organiseBy: 'none' })
      .withCsrfToken()
      .loginAs(office)
    const waiting = await draft()
    assert.equal(waiting.disabledReason, it('ui.jobs.draftWaiting'))
  })

  test('"Da fatturare" counts the work a draft would bill, not what is still planned', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const job = await createJob(await createCustomer(), { status: 'in_progress' })
    const startsAt = DateTime.fromISO('2026-11-06T09:00')
    const planned = await Visit.create({
      jobId: job.id,
      startsAt,
      endsAt: startsAt.plus({ hours: 2 }),
      status: 'planned',
    })
    const valve = await createItem({ description: 'Valvola', unit: 'pz' })
    await Charge.create({
      jobId: job.id,
      visitId: planned.id,
      kind: 'item',
      itemId: valve.id,
      quantity: '1',
      billQuantity: '1',
      unitPrice: '80',
      description: 'Valvola',
    })
    const toBill = async () => {
      const page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
      return (page.inertiaProps.timeAndMaterials as { toBill: string }).toBill
    }
    assert.equal(await toBill(), '0.00')

    await client
      .post(`/jobs/${job.id}/charges`)
      .form({
        description: 'Diritto di chiamata',
        quantity: '1',
        unit: '',
        unitPrice: '30',
        vatKind: 'labour',
      })
      .withCsrfToken()
      .loginAs(office)
    assert.equal(await toBill(), '30.00')
  })

  test('Office adds costs to a Job that takes new work only', async ({ client, assert }) => {
    const office = await createUser('office')
    const customer = await createCustomer()
    for (const [status, allowed] of [
      ['open', true],
      ['in_progress', true],
      ['closed', false],
      ['cancelled', false],
    ] as const) {
      const job = await createJob(customer, { status })
      const page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
      assert.equal(page.inertiaProps.canAddCharge, allowed, status)
    }
  })

  test('a closed Job is reopened from its header; a cancelled one has nothing to change', async ({
    client,
    assert,
  }) => {
    const customer = await createCustomer()
    const closed = await createJob(customer, { status: 'closed' })
    const cancelled = await createJob(customer, { status: 'cancelled' })

    assert.deepEqual(ranked(await actionsOf(client, closed.id)), [
      'draftInvoice:primary',
      'reopen:secondary',
      'edit:overflow',
      'newLegacyInvoice:overflow',
    ])
    assert.deepEqual(ranked(await actionsOf(client, cancelled.id)), [
      'draftInvoice:primary',
      'newLegacyInvoice:overflow',
    ])
  })
})
