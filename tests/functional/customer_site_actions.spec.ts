import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import { DateTime } from 'luxon'
import type { ScreenAction } from '#shared/screen_actions'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createSite } from '#tests/helpers/sites'
import { createJob } from '#tests/helpers/jobs'
import { it } from '#tests/helpers/i18n'

/** A screen's header actions (docs/ui.md "Actions") and its props */
async function screen(client: ApiClient, url: string, role: 'office' | 'admin' = 'office') {
  const page = await client
    .get(url)
    .withInertia()
    .loginAs(await createUser(role))
  page.assertStatus(200)
  return { actions: page.inertiaProps.actions as ScreenAction[], props: page.inertiaProps }
}
const ranked = (actions: ScreenAction[]) => actions.map((action) => `${action.name}:${action.rank}`)

test.group('Customer and Site screen actions (#239)', () => {
  test('a Customer: a new Job first, editing and calling beside it, archiving in "⋯"', async ({
    client,
    assert,
  }) => {
    const customer = await createCustomer({ phone: '+39 0461 123 456' })
    await createJob(customer)

    for (const role of ['office', 'admin'] as const) {
      const { actions, props } = await screen(client, `/customers/${customer.id}`, role)
      assert.deepEqual(ranked(actions), [
        'newJob:primary',
        'edit:secondary',
        'call:secondary',
        'archive:overflow',
      ])
      const byName = Object.fromEntries(actions.map((action) => [action.name, action]))
      assert.equal(byName.newJob.href, `/jobs/create?customerId=${customer.id}`)
      assert.equal(byName.call.href, 'tel:+390461123456')
      assert.isTrue(byName.archive.destructive)
      assert.equal(byName.archive.confirm, it('ui.archive.confirm'))
      assert.equal(byName.archive.href, `/customers/${customer.id}/archive`)
      assert.equal(props.openJobs, 1)
      assert.isTrue(props.canAddInvoice)
    }
  })

  test('an archived Customer takes no new Job and offers restoring; no phone, no call', async ({
    client,
    assert,
  }) => {
    const customer = await createCustomer({ archivedAt: DateTime.now() })

    const { actions } = await screen(client, `/customers/${customer.id}`)
    assert.deepEqual(ranked(actions), ['edit:secondary', 'restore:secondary'])
    assert.isFalse(actions.find((action) => action.name === 'restore')!.destructive)
  })

  test('a Site: editing and the map, archiving in "⋯"; its open Jobs and next check', async ({
    client,
    assert,
  }) => {
    const site = await createSite({ street: 'Via Roma', streetNumber: '5', city: 'Milano' })
    const customer = await createCustomer()
    await createJob(customer, { siteId: site.id })
    await createJob(customer, { siteId: site.id, status: 'closed' })
    await site.related('installedEquipment').createMany([
      {
        equipmentType: 'Caldaia',
        installedOn: DateTime.fromISO('2025-05-20'),
        maintenanceIntervalMonths: 12,
      },
      {
        equipmentType: 'Addolcitore',
        installedOn: DateTime.fromISO('2025-03-01'),
        maintenanceIntervalMonths: 12,
      },
    ])

    const { actions, props } = await screen(client, `/sites/${site.id}`)
    assert.deepEqual(ranked(actions), ['edit:secondary', 'map:secondary', 'archive:overflow'])
    const map = actions.find((action) => action.name === 'map')!
    assert.equal(
      map.href,
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(site.address)}`
    )
    assert.equal(props.openJobs, 1)
    assert.equal(props.nextDueOn, '2026-03-01')
  })

  test('the forms have Save as their primary, submitting the form', async ({ client, assert }) => {
    const customer = await createCustomer()
    const site = await createSite()
    const forms: [string, string][] = [
      ['/customers/create', it('ui.customers.save')],
      [`/customers/${customer.id}/edit`, it('ui.customers.save')],
      ['/sites/create', it('ui.sites.save')],
      [`/sites/${site.id}/edit`, it('ui.sites.save')],
      [`/sites/${site.id}/equipment/create`, it('ui.equipment.save')],
    ]
    for (const [url, label] of forms) {
      const { actions } = await screen(client, url)
      assert.deepEqual(
        actions.map(({ name, rank, kind, label: shown }) => ({ name, rank, kind, shown })),
        [{ name: 'save', rank: 'primary', kind: 'submit', shown: label }],
        url
      )
    }
  })
})
