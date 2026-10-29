import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import Charge from '#models/charge'
import Job from '#models/job'
import InstalledEquipment from '#models/installed_equipment'
import type Site from '#models/site'
import type User from '#models/user'
import Visit from '#models/visit'
import FieldWork from '#services/field_work'
import StockLedger from '#stock/stock_ledger'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createSite } from '#tests/helpers/sites'
import { createItem } from '#tests/helpers/items'
import { createJob } from '#tests/helpers/jobs'
import { completeCompany } from '#tests/helpers/company'
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'

function send(client: ApiClient, user: User, method: 'post' | 'put', url: string, body = {}) {
  return client[method](url)
    .json(body)
    .header('referer', '/')
    .withCsrfToken()
    .loginAs(user)
    .redirects(0)
}

function equipmentAt(site: Site) {
  return InstalledEquipment.query().where('siteId', site.id).orderBy('id')
}

/**
 * A Job in progress at a Site with an old boiler, and an open Visit on 20
 * October where Anna works; two boiler models in stock.
 */
async function setup() {
  await completeCompany()
  const office = await createUser('office')
  const anna = await createUser('technician')
  const site = await createSite()
  const job = await createJob(await createCustomer(), { status: 'in_progress', siteId: site.id })
  const start = DateTime.fromISO('2026-10-20T09:00')
  const visit = await Visit.create({
    jobId: job.id,
    startsAt: start,
    endsAt: start.plus({ hours: 3 }),
    status: 'in_progress',
  })
  await visit.related('technicians').attach([anna.id])
  const boilerA = await createItem({
    description: 'Caldaia A 25 kW',
    resalePrice: '1200',
    maintenanceIntervalMonths: 12,
  })
  const boilerB = await createItem({
    description: 'Caldaia B 30 kW',
    resalePrice: '1500',
    maintenanceIntervalMonths: 24,
  })
  for (const item of [boilerA, boilerB]) {
    await StockLedger.receive(item, { quantity: '5', occurredOn: start })
  }
  const old = await InstalledEquipment.create({
    siteId: site.id,
    equipmentType: 'Caldaia',
    serialNumber: 'OLD-1',
    installedOn: DateTime.fromISO('2015-03-01'),
  })
  return { office, anna, site, job, visit, boilerA, boilerB, old }
}

/**
 * Anna records a new boiler installed, with its details.
 */
async function recordNewBoiler(client: ApiClient, anna: User, visit: Visit, itemId: number) {
  const response = await send(client, anna, 'post', `/my-visits/${visit.id}/items`, {
    itemId,
    quantity: '1',
    installed: true,
    equipmentType: 'Caldaia murale',
    make: 'Vaillant',
    model: 'ecoTEC',
    serialNumber: 'SN-777',
  })
  response.assertFlashMessage('success', it('flash.visitItemAdded'))
  return Charge.query().where('visitId', visit.id).orderBy('id', 'desc').firstOrFail()
}

/**
 * Anna closes the Visit, unticking `notDone` in the review.
 */
async function close(client: ApiClient, anna: User, visit: Visit, notDone: number[] = []) {
  const charges = await Charge.query().where('visitId', visit.id)
  const ids = charges.map((charge) => charge.id)
  const response = await send(client, anna, 'post', `/my-visits/${visit.id}/status`, {
    status: 'done',
    reviewed: ids,
    done: ids.filter((id) => !notDone.includes(id)),
  })
  response.assertFlashMessage('success', it('flash.visitStatusSaved'))
}

test.group('Installed Equipment from installed Items (#162)', () => {
  test('recording keeps the details on the Charge; closing the Visit creates it on its day', async ({
    client,
    assert,
  }) => {
    const { anna, site, visit, boilerA, old } = await setup()

    const charge = await recordNewBoiler(client, anna, visit, boilerA.id)
    assert.deepEqual(
      [
        charge.installed,
        charge.equipmentType,
        charge.equipmentMake,
        charge.equipmentModel,
        charge.equipmentSerialNumber,
        charge.installedEquipmentId,
      ],
      [true, 'Caldaia murale', 'Vaillant', 'ecoTEC', 'SN-777', null]
    )
    const before = await equipmentAt(site)
    assert.deepEqual(
      before.map((equipment) => equipment.id),
      [old.id]
    )

    await close(client, anna, visit)

    const [, created] = await equipmentAt(site)
    assert.deepEqual(
      [
        created.itemId,
        created.equipmentType,
        created.make,
        created.model,
        created.serialNumber,
        created.maintenanceIntervalMonths,
        created.installedOn?.toISODate(),
      ],
      [boilerA.id, 'Caldaia murale', 'Vaillant', 'ecoTEC', 'SN-777', 12, '2026-10-20']
    )
    await charge.refresh()
    assert.equal(charge.installedEquipmentId, created.id)
    assert.isTrue(charge.createdEquipment)
  })

  test('onto equipment already at the Site: updated only when done', async ({ client, assert }) => {
    const { anna, site, visit, boilerA, old } = await setup()

    const response = await send(client, anna, 'post', `/my-visits/${visit.id}/items`, {
      itemId: boilerA.id,
      quantity: '1',
      installed: true,
      equipmentId: old.id,
      serialNumber: 'SN-9',
    })
    response.assertFlashMessage('success', it('flash.visitItemAdded'))
    await old.refresh()
    assert.deepEqual([old.itemId, old.serialNumber], [null, 'OLD-1'])

    await close(client, anna, visit)

    await old.refresh()
    assert.deepEqual(
      [old.itemId, old.serialNumber, old.installedOn?.toISODate(), old.maintenanceIntervalMonths],
      [boilerA.id, 'SN-9', '2015-03-01', 12]
    )
    assert.lengthOf(await equipmentAt(site), 1)
    const charge = await Charge.findByOrFail('visitId', visit.id)
    assert.equal(charge.installedEquipmentId, old.id)
    assert.isFalse(charge.createdEquipment)
  })

  test('removing a planned installed Charge in the field leaves equipment alone', async ({
    client,
    assert,
  }) => {
    const { anna, site, visit, boilerA, old } = await setup()
    await FieldWork.recordItem(visit, {
      itemId: boilerA.id,
      quantity: '1',
      installed: true,
      equipmentId: old.id,
    })
    const created = await recordNewBoiler(client, anna, visit, boilerA.id)
    const linked = await Charge.query().where('visitId', visit.id).orderBy('id').firstOrFail()

    for (const charge of [linked, created]) {
      await client.delete(`/charges/${charge.id}`).withCsrfToken().loginAs(anna)
    }

    assert.lengthOf(await Charge.query().where('visitId', visit.id), 0)
    const [kept] = await equipmentAt(site)
    assert.deepEqual([kept.id, kept.itemId, kept.serialNumber], [old.id, null, 'OLD-1'])
  })

  test("unticked at close it installs nothing; Office marking it done does, on the Visit's day", async ({
    client,
    assert,
  }) => {
    const { office, anna, site, visit, boilerA, old } = await setup()
    const charge = await recordNewBoiler(client, anna, visit, boilerA.id)

    await close(client, anna, visit, [charge.id])
    assert.lengthOf(await equipmentAt(site), 1)

    const response = await send(client, office, 'post', `/charges/${charge.id}/done`)
    response.assertFlashMessage('success', it('flash.chargeWork.done'))

    const [kept, created] = await equipmentAt(site)
    assert.equal(kept.id, old.id)
    assert.deepEqual(
      [created.itemId, created.serialNumber, created.installedOn?.toISODate()],
      [boilerA.id, 'SN-777', '2026-10-20']
    )
  })

  test('{$self} marks it not done: the equipment stays, named in a warning; done again reuses it')
    .with(['office', 'admin'] as const)
    .run(async ({ client, assert }, role) => {
      const user = await createUser(role)
      const { anna, site, visit, boilerA } = await setup()
      const charge = await recordNewBoiler(client, anna, visit, boilerA.id)
      await close(client, anna, visit)
      const [, created] = await equipmentAt(site)

      const notDone = await send(client, user, 'post', `/charges/${charge.id}/not-done`)
      notDone.assertFlashMessage(
        'warning',
        `${it('flash.chargeWork.not_done')} ${it('flash.equipmentWarning.left', {
          equipment: 'Caldaia murale — Vaillant ecoTEC',
        })}`
      )
      await created.refresh()
      assert.deepEqual([created.itemId, created.removedOn], [boilerA.id, null])

      // Edited by hand meanwhile: done again, it is reused as it is
      created.serialNumber = 'SN-778'
      await created.save()
      const done = await send(client, user, 'post', `/charges/${charge.id}/done`)
      done.assertFlashMessage('success', it('flash.chargeWork.done'))
      const after = await equipmentAt(site)
      assert.lengthOf(after, 2)
      assert.equal(after[1].serialNumber, 'SN-778')
      await charge.refresh()
      assert.equal(charge.installedEquipmentId, created.id)

      // Gone since: done again, it is created anew
      await send(client, user, 'post', `/charges/${charge.id}/not-done`)
      await db.from('installed_equipment').where('id', created.id).delete()
      await send(client, user, 'post', `/charges/${charge.id}/done`)
      const recreated = await equipmentAt(site)
      assert.lengthOf(recreated, 2)
      assert.notEqual(recreated[1].id, created.id)
      assert.equal(recreated[1].serialNumber, 'SN-777')
    })

  test('not done onto equipment already at the Site warns too, and leaves it', async ({
    client,
    assert,
  }) => {
    const { office, anna, visit, boilerA, old } = await setup()
    const charge = await FieldWork.recordItem(visit, {
      itemId: boilerA.id,
      quantity: '1',
      installed: true,
      equipmentId: old.id,
    })
    await close(client, anna, visit)

    const response = await send(client, office, 'post', `/charges/${charge.id}/not-done`)
    response.assertFlashMessage(
      'warning',
      `${it('flash.chargeWork.not_done')} ${it('flash.equipmentWarning.left', { equipment: 'Caldaia' })}`
    )
    await old.refresh()
    assert.equal(old.itemId, boilerA.id)
  })

  test("correcting a done Charge's Item leaves the equipment, named in a warning", async ({
    client,
    assert,
  }) => {
    const { office, anna, site, visit, boilerA, boilerB } = await setup()
    const charge = await recordNewBoiler(client, anna, visit, boilerA.id)
    await close(client, anna, visit)

    const response = await send(client, office, 'put', `/charges/${charge.id}/recorded`, {
      itemId: boilerB.id,
      quantity: '1',
    })
    response.assertFlashMessage(
      'warning',
      `${it('flash.chargeCorrected')} ${it('flash.equipmentWarning.left', {
        equipment: 'Caldaia murale — Vaillant ecoTEC',
      })}`
    )
    await charge.refresh()
    assert.equal(charge.itemId, boilerB.id)
    const [, created] = await equipmentAt(site)
    assert.deepEqual(
      [created.itemId, created.equipmentType, created.maintenanceIntervalMonths],
      [boilerA.id, 'Caldaia murale', 12]
    )

    // The quantity alone: nothing to warn about
    const quantity = await send(client, office, 'put', `/charges/${charge.id}/recorded`, {
      itemId: boilerB.id,
      quantity: '2',
    })
    quantity.assertFlashMessage('success', it('flash.chargeCorrected'))
  })

  test('a Charge corrected before it is done installs the new Item', async ({ client, assert }) => {
    const { office, anna, site, visit, boilerA, boilerB } = await setup()
    const charge = await recordNewBoiler(client, anna, visit, boilerA.id)

    const response = await send(client, office, 'put', `/charges/${charge.id}/recorded`, {
      itemId: boilerB.id,
      quantity: '1',
    })
    response.assertFlashMessage('success', it('flash.chargeCorrected'))
    assert.lengthOf(await equipmentAt(site), 1)

    await close(client, anna, visit)
    const [, created] = await equipmentAt(site)
    assert.deepEqual(
      [created.itemId, created.equipmentType, created.maintenanceIntervalMonths],
      [boilerB.id, 'Caldaia murale', 24]
    )
  })

  test('a cancelled Visit installs nothing; restored and closed, it does', async ({
    client,
    assert,
  }) => {
    const { office, anna, site, visit, boilerA } = await setup()
    await recordNewBoiler(client, anna, visit, boilerA.id)

    const cancelled = await send(client, office, 'post', `/visits/${visit.id}/cancel`)
    cancelled.assertFlashMessage('success', it('flash.visitCancelled'))
    assert.lengthOf(await equipmentAt(site), 1)

    await send(client, office, 'post', `/visits/${visit.id}/restore`)
    await close(client, anna, visit)
    assert.lengthOf(await equipmentAt(site), 2)
  })

  test('{$self} marking done a Visit left open on a cancelled Job installs its done Items')
    .with(['office', 'admin'] as const)
    .run(async ({ client, assert }, role) => {
      const user = await createUser(role)
      const { anna, site, job, visit, boilerA, boilerB } = await setup()
      const installed = await recordNewBoiler(client, anna, visit, boilerA.id)
      const unused = await recordNewBoiler(client, anna, visit, boilerB.id)
      await send(client, user, 'post', `/jobs/${job.id}/cancel`)

      const response = await send(client, user, 'post', `/visits/${visit.id}/done`, {
        reviewed: [installed.id, unused.id],
        done: [installed.id],
      })
      response.assertFlashMessage('success', it('flash.visitMarkedDone'))

      const [, created] = await equipmentAt(site)
      assert.lengthOf(await equipmentAt(site), 2)
      assert.deepEqual(
        [created.itemId, created.installedOn?.toISODate()],
        [boilerA.id, '2026-10-20']
      )
    })

  test('Technicians and the Superuser can not mark it done or not done, or correct it', async ({
    client,
    assert,
  }) => {
    const { anna, site, visit, boilerA, boilerB } = await setup()
    const charge = await recordNewBoiler(client, anna, visit, boilerA.id)
    await close(client, anna, visit, [charge.id])

    for (const user of [anna, await createUser('technician'), await createUser('superuser')]) {
      for (const [method, url, body] of [
        ['post', `/charges/${charge.id}/done`, {}],
        ['post', `/charges/${charge.id}/not-done`, {}],
        ['put', `/charges/${charge.id}/recorded`, { itemId: boilerB.id, quantity: '1' }],
      ] as const) {
        const denied = await send(client, user, method, url, body)
        denied.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
      }
    }
    assert.lengthOf(await equipmentAt(site), 1)
    await charge.refresh()
    assert.equal(charge.itemId, boilerA.id)
  })
})

/**
 * Anna's installed boiler goes onto the old one at the Site.
 */
function recordOntoOld(visit: Visit, itemId: number, old: InstalledEquipment) {
  return FieldWork.recordItem(visit, {
    itemId,
    quantity: '1',
    installed: true,
    equipmentId: old.id,
    serialNumber: 'SN-9',
  })
}

/**
 * Anna closes the Visit with everything done, as `status`.
 */
async function closeAllDone(
  client: ApiClient,
  anna: User,
  visit: Visit,
  status: 'done' | 'needs_return' = 'done'
) {
  const charges = await Charge.query().where('visitId', visit.id)
  const ids = charges.map((charge) => charge.id)
  return send(client, anna, 'post', `/my-visits/${visit.id}/status`, {
    status,
    reviewed: ids,
    done: ids,
  })
}

/**
 * The flash: `success`, then a warning naming each equipment in turn.
 */
function warned(success: string, warnings: [string, string][]) {
  return [
    it(success),
    ...warnings.map(([reason, equipment]) => it(`flash.equipmentWarning.${reason}`, { equipment })),
  ].join(' ')
}

test.group('Equipment changed between recording and done (#168)', () => {
  test('the unit marked removed meanwhile: closing updates it, it stays removed, with a warning', async ({
    client,
    assert,
  }) => {
    const { anna, visit, boilerA, old } = await setup()
    await recordOntoOld(visit, boilerA.id, old)
    old.removedOn = DateTime.fromISO('2026-10-19')
    await old.save()

    const response = await closeAllDone(client, anna, visit)
    response.assertFlashMessage(
      'warning',
      warned('flash.visitStatusSaved', [['removed', 'Caldaia']])
    )
    await old.refresh()
    assert.deepEqual(
      [old.itemId, old.serialNumber, old.removedOn?.toISODate()],
      [boilerA.id, 'SN-9', '2026-10-19']
    )
  })

  test("the Job's Site changed meanwhile: closing updates the unit where it is, with a warning", async ({
    client,
    assert,
  }) => {
    const { anna, site, job, visit, boilerA, old } = await setup()
    await recordOntoOld(visit, boilerA.id, old)
    const other = await createSite({ street: 'Via Verdi' })
    job.siteId = other.id
    await job.save()

    const response = await closeAllDone(client, anna, visit, 'needs_return')
    response.assertFlashMessage(
      'warning',
      warned('flash.visitStatusSaved', [['elsewhere', 'Caldaia']])
    )
    await old.refresh()
    assert.deepEqual([old.itemId, old.siteId], [boilerA.id, site.id])
    assert.lengthOf(await equipmentAt(other), 0)
  })

  test("the Job's Site cleared meanwhile: closing creates nothing, naming the new unit", async ({
    client,
    assert,
  }) => {
    const { anna, site, job, visit, boilerA, old } = await setup()
    const charge = await recordNewBoiler(client, anna, visit, boilerA.id)
    job.siteId = null
    await job.save()

    const response = await closeAllDone(client, anna, visit)
    response.assertFlashMessage(
      'warning',
      warned('flash.visitStatusSaved', [['noSite', 'Caldaia murale — Vaillant ecoTEC']])
    )
    const kept = await equipmentAt(site)
    assert.deepEqual(
      kept.map((equipment) => equipment.id),
      [old.id]
    )
    // Done all the same: off stock, with nothing installed
    await charge.refresh()
    assert.isNotNull(charge.stockMovementId)
    assert.isNull(charge.installedEquipmentId)
  })

  test('nothing changed: closing warns of nothing', async ({ client }) => {
    const { anna, visit, boilerA, old } = await setup()
    await recordOntoOld(visit, boilerA.id, old)
    const response = await closeAllDone(client, anna, visit)
    response.assertFlashMessage('success', it('flash.visitStatusSaved'))
  })

  test('{$self} marking a Charge done is warned of each case, never refused')
    .with(['office', 'admin'] as const)
    .run(async ({ client, assert }, role) => {
      const user = await createUser(role)
      const { anna, site, job, visit, boilerA, boilerB, old } = await setup()
      const onto = await recordOntoOld(visit, boilerA.id, old)
      const created = await recordNewBoiler(client, anna, visit, boilerB.id)
      await close(client, anna, visit, [onto.id, created.id])

      // Removed, and at another Site than the Job's: both said, still updated
      old.removedOn = DateTime.fromISO('2026-10-21')
      await old.save()
      const other = await createSite({ street: 'Via Verdi' })
      job.siteId = other.id
      await job.save()
      const ontoDone = await send(client, user, 'post', `/charges/${onto.id}/done`)
      ontoDone.assertFlashMessage(
        'warning',
        warned('flash.chargeWork.done', [
          ['removed', 'Caldaia'],
          ['elsewhere', 'Caldaia'],
        ])
      )
      await old.refresh()
      assert.deepEqual(
        [old.itemId, old.siteId, old.removedOn?.toISODate()],
        [boilerA.id, site.id, '2026-10-21']
      )

      // No Site: the new unit isn't created, and is named
      job.siteId = null
      await job.save()
      const createdDone = await send(client, user, 'post', `/charges/${created.id}/done`)
      createdDone.assertFlashMessage(
        'warning',
        warned('flash.chargeWork.done', [['noSite', 'Caldaia murale — Vaillant ecoTEC']])
      )
      await created.refresh()
      assert.isNotNull(created.stockMovementId)
      assert.isNull(created.installedEquipmentId)
      assert.lengthOf(await equipmentAt(site), 1)
      assert.lengthOf(await equipmentAt(other), 0)
    })

  test('{$self} marking done a Visit on a cancelled Job is warned too')
    .with(['office', 'admin'] as const)
    .run(async ({ client, assert }, role) => {
      const user = await createUser(role)
      const { anna, site, job, visit, boilerA, boilerB, old } = await setup()
      const onto = await recordOntoOld(visit, boilerA.id, old)
      const created = await recordNewBoiler(client, anna, visit, boilerB.id)
      await send(client, user, 'post', `/jobs/${job.id}/cancel`)
      old.removedOn = DateTime.fromISO('2026-10-21')
      await old.save()
      await Job.query().where('id', job.id).update({ site_id: null })

      const response = await send(client, user, 'post', `/visits/${visit.id}/done`, {
        reviewed: [onto.id, created.id],
        done: [onto.id, created.id],
      })
      response.assertFlashMessage(
        'warning',
        warned('flash.visitMarkedDone', [
          ['removed', 'Caldaia'],
          ['elsewhere', 'Caldaia'],
          ['noSite', 'Caldaia murale — Vaillant ecoTEC'],
        ])
      )
      await old.refresh()
      assert.equal(old.itemId, boilerA.id)
      assert.lengthOf(await equipmentAt(site), 1)
    })
})
