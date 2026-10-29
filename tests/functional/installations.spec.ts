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
import Quotes from '#services/quotes'
import StockLedger from '#stock/stock_ledger'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createSite } from '#tests/helpers/sites'
import { createItem, vatCode } from '#tests/helpers/items'
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
 * October where Anna works; two boiler models in stock (Equipment, having
 * a maintenance interval) and a fitting (not Equipment).
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
  const fitting = await createItem({ description: 'Raccordo' })
  for (const item of [boilerA, boilerB, fitting]) {
    await StockLedger.receive(item, { quantity: '5', occurredOn: start })
  }
  const old = await InstalledEquipment.create({
    siteId: site.id,
    equipmentType: 'Caldaia',
    serialNumber: 'OLD-1',
    installedOn: DateTime.fromISO('2015-03-01'),
  })
  return { office, anna, site, job, visit, boilerA, boilerB, fitting, old }
}

/**
 * Anna records `quantity` of an Item, with an Equipment Item's details.
 */
async function recordBoiler(
  client: ApiClient,
  anna: User,
  visit: Visit,
  itemId: number,
  quantity = '1'
) {
  const response = await send(client, anna, 'post', `/my-visits/${visit.id}/items`, {
    itemId,
    quantity,
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
  return send(client, anna, 'post', `/my-visits/${visit.id}/status`, {
    status: 'done',
    reviewed: ids,
    done: ids.filter((id) => !notDone.includes(id)),
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

test.group('Installed Equipment from Equipment Items (#162, #176)', () => {
  test('recording keeps the details on the Charge; closing the Visit creates it on its day', async ({
    client,
    assert,
  }) => {
    const { anna, site, visit, boilerA, old } = await setup()

    const charge = await recordBoiler(client, anna, visit, boilerA.id)
    assert.deepEqual(
      [
        charge.equipmentType,
        charge.equipmentMake,
        charge.equipmentModel,
        charge.equipmentSerialNumber,
      ],
      ['Caldaia murale', 'Vaillant', 'ecoTEC', 'SN-777']
    )
    const before = await equipmentAt(site)
    assert.deepEqual(
      before.map((equipment) => equipment.id),
      [old.id]
    )

    const response = await close(client, anna, visit)
    response.assertFlashMessage('success', it('flash.visitStatusSaved'))

    const [kept, created] = await equipmentAt(site)
    assert.deepEqual(
      [
        created.itemId,
        created.equipmentType,
        created.make,
        created.model,
        created.serialNumber,
        created.maintenanceIntervalMonths,
        created.installedOn?.toISODate(),
        created.chargeId,
      ],
      [boilerA.id, 'Caldaia murale', 'Vaillant', 'ecoTEC', 'SN-777', 12, '2026-10-20', charge.id]
    )
    // The unit already at the Site is never touched
    assert.deepEqual([kept.id, kept.itemId, kept.serialNumber], [old.id, null, 'OLD-1'])
  })

  test('an Item that is not Equipment creates nothing and keeps no details', async ({
    client,
    assert,
  }) => {
    const { anna, site, visit, fitting } = await setup()

    const charge = await recordBoiler(client, anna, visit, fitting.id)
    assert.deepEqual([charge.equipmentType, charge.equipmentSerialNumber], [null, null])
    await close(client, anna, visit)

    assert.lengthOf(await equipmentAt(site), 1)
  })

  test('several pieces create one unit each, sharing the details, serial numbers left empty', async ({
    client,
    assert,
  }) => {
    const { anna, site, visit, boilerA } = await setup()

    const charge = await recordBoiler(client, anna, visit, boilerA.id, '3')
    assert.isNull(charge.equipmentSerialNumber)
    await close(client, anna, visit)

    const [, ...created] = await equipmentAt(site)
    assert.deepEqual(
      created.map((unit) => [unit.itemId, unit.description, unit.serialNumber, unit.chargeId]),
      Array(3).fill([boilerA.id, 'Caldaia murale — Vaillant ecoTEC', null, charge.id])
    )
  })

  test('part of an Equipment Item is refused in the field', async ({ client, assert }) => {
    const { anna, visit, boilerA, fitting } = await setup()

    const response = await send(client, anna, 'post', `/my-visits/${visit.id}/items`, {
      itemId: boilerA.id,
      quantity: '1,5',
    })
    response.assertFlashMessage('error', it('flash.fieldWorkRefused.wholeQuantity'))
    assert.lengthOf(await Charge.query().where('visitId', visit.id), 0)

    // Any other Item takes a part
    await send(client, anna, 'post', `/my-visits/${visit.id}/items`, {
      itemId: fitting.id,
      quantity: '1,5',
    })
    assert.lengthOf(await Charge.query().where('visitId', visit.id), 1)
  })

  test('the Item decides when done: one no longer Equipment creates nothing', async ({
    client,
    assert,
  }) => {
    const { anna, site, visit, boilerA } = await setup()
    await recordBoiler(client, anna, visit, boilerA.id)
    boilerA.equipment = false
    await boilerA.save()

    await close(client, anna, visit)
    assert.lengthOf(await equipmentAt(site), 1)
  })

  test('removing a planned Charge in the field leaves equipment alone', async ({
    client,
    assert,
  }) => {
    const { anna, site, visit, boilerA, old } = await setup()
    const charge = await recordBoiler(client, anna, visit, boilerA.id)

    await client.delete(`/charges/${charge.id}`).withCsrfToken().loginAs(anna)

    assert.lengthOf(await Charge.query().where('visitId', visit.id), 0)
    const [kept] = await equipmentAt(site)
    assert.deepEqual([kept.id, kept.itemId, kept.serialNumber], [old.id, null, 'OLD-1'])
  })

  test("unticked at close it installs nothing; Office marking it done does, on the Visit's day", async ({
    client,
    assert,
  }) => {
    const { office, anna, site, visit, boilerA, old } = await setup()
    const charge = await recordBoiler(client, anna, visit, boilerA.id)

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
      const charge = await recordBoiler(client, anna, visit, boilerA.id, '2')
      await close(client, anna, visit)
      const [, ...created] = await equipmentAt(site)
      assert.lengthOf(created, 2)

      // Both units have the same details: named once
      const notDone = await send(client, user, 'post', `/charges/${charge.id}/not-done`)
      notDone.assertFlashMessage(
        'warning',
        warned('flash.chargeWork.not_done', [['left', 'Caldaia murale — Vaillant ecoTEC']])
      )
      assert.lengthOf(await equipmentAt(site), 3)

      // One deleted by hand meanwhile: done again, the other is kept as it is
      await created[0].delete()
      const done = await send(client, user, 'post', `/charges/${charge.id}/done`)
      done.assertFlashMessage('success', it('flash.chargeWork.done'))
      const after = await equipmentAt(site)
      assert.deepEqual(
        after.slice(1).map((unit) => unit.id),
        [created[1].id]
      )

      // All gone since: done again, they are created anew
      await send(client, user, 'post', `/charges/${charge.id}/not-done`)
      await db.from('installed_equipment').where('id', created[1].id).delete()
      await send(client, user, 'post', `/charges/${charge.id}/done`)
      const recreated = await equipmentAt(site)
      assert.lengthOf(recreated, 3)
      assert.notInclude(
        recreated.map((unit) => unit.id),
        created[1].id
      )
    })

  test(
    "{$self} correcting a done Charge's Item or quantity leaves the equipment, named in a warning"
  )
    .with(['office', 'admin'] as const)
    .run(async ({ client, assert }, role) => {
      const user = await createUser(role)
      const { anna, site, visit, boilerA, boilerB } = await setup()
      const charge = await recordBoiler(client, anna, visit, boilerA.id)
      await close(client, anna, visit)

      const item = await send(client, user, 'put', `/charges/${charge.id}/recorded`, {
        itemId: boilerB.id,
        quantity: '1',
      })
      item.assertFlashMessage(
        'warning',
        warned('flash.chargeCorrected', [['left', 'Caldaia murale — Vaillant ecoTEC']])
      )
      await charge.refresh()
      assert.equal(charge.itemId, boilerB.id)

      const quantity = await send(client, user, 'put', `/charges/${charge.id}/recorded`, {
        itemId: boilerB.id,
        quantity: '2',
      })
      quantity.assertFlashMessage(
        'warning',
        warned('flash.chargeCorrected', [['quantity', 'Caldaia murale — Vaillant ecoTEC']])
      )
      const [, created] = await equipmentAt(site)
      assert.lengthOf(await equipmentAt(site), 2)
      assert.deepEqual(
        [created.itemId, created.equipmentType, created.maintenanceIntervalMonths],
        [boilerA.id, 'Caldaia murale', 12]
      )
    })

  test('{$self} correcting an Equipment Charge to part of a piece is refused')
    .with(['office', 'admin'] as const)
    .run(async ({ client, assert }, role) => {
      const user = await createUser(role)
      const { anna, visit, boilerA, fitting } = await setup()
      const charge = await recordBoiler(client, anna, visit, fitting.id)

      const response = await send(client, user, 'put', `/charges/${charge.id}/recorded`, {
        itemId: boilerA.id,
        quantity: '0,5',
      })
      response.assertFlashMessage('error', it('flash.chargeRefused.wholeQuantity'))
      await charge.refresh()
      assert.deepEqual([charge.itemId, charge.quantity], [fitting.id, '1.000'])
    })

  test('a Charge corrected before it is done installs as corrected', async ({ client, assert }) => {
    const { office, anna, site, visit, boilerA, boilerB } = await setup()
    const charge = await recordBoiler(client, anna, visit, boilerA.id)

    const response = await send(client, office, 'put', `/charges/${charge.id}/recorded`, {
      itemId: boilerB.id,
      quantity: '2',
    })
    response.assertFlashMessage('success', it('flash.chargeCorrected'))
    assert.lengthOf(await equipmentAt(site), 1)

    await close(client, anna, visit)
    const [, ...created] = await equipmentAt(site)
    // Two pieces now: the serial number recorded for one is left out
    assert.deepEqual(
      created.map((unit) => [unit.itemId, unit.maintenanceIntervalMonths, unit.serialNumber]),
      [
        [boilerB.id, 24, null],
        [boilerB.id, 24, null],
      ]
    )
  })

  test('a cancelled Visit installs nothing; restored and closed, it does', async ({
    client,
    assert,
  }) => {
    const { office, anna, site, visit, boilerA } = await setup()
    await recordBoiler(client, anna, visit, boilerA.id)

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
      const installed = await recordBoiler(client, anna, visit, boilerA.id)
      const unused = await recordBoiler(client, anna, visit, boilerB.id)
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
    const charge = await recordBoiler(client, anna, visit, boilerA.id)
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

test.group('Equipment Items on a Job without a Site (#168, #176)', () => {
  test('recorded without a Site, closing creates nothing and tells the Technician to tell the office', async ({
    client,
    assert,
  }) => {
    const { anna, site, job, visit, boilerA, old } = await setup()
    job.siteId = null
    await job.save()
    const charge = await recordBoiler(client, anna, visit, boilerA.id)

    const response = await close(client, anna, visit)
    response.assertFlashMessage(
      'warning',
      warned('flash.visitStatusSaved', [['noSiteTechnician', 'Caldaia murale — Vaillant ecoTEC']])
    )
    const kept = await equipmentAt(site)
    assert.deepEqual(
      kept.map((equipment) => equipment.id),
      [old.id]
    )
    // Done all the same: off stock, with nothing installed
    await charge.refresh()
    assert.isNotNull(charge.stockMovementId)
    assert.lengthOf(await InstalledEquipment.query().where('chargeId', charge.id), 0)
  })

  test('{$self} marking a Charge done without a Site is warned, never refused')
    .with(['office', 'admin'] as const)
    .run(async ({ client, assert }, role) => {
      const user = await createUser(role)
      const { anna, site, job, visit, boilerA } = await setup()
      const charge = await recordBoiler(client, anna, visit, boilerA.id)
      await close(client, anna, visit, [charge.id])
      job.siteId = null
      await job.save()

      const response = await send(client, user, 'post', `/charges/${charge.id}/done`)
      response.assertFlashMessage(
        'warning',
        warned('flash.chargeWork.done', [['noSite', 'Caldaia murale — Vaillant ecoTEC']])
      )
      await charge.refresh()
      assert.isNotNull(charge.stockMovementId)
      assert.lengthOf(await equipmentAt(site), 1)
    })

  test('{$self} marking done a Visit on a cancelled Job is warned too')
    .with(['office', 'admin'] as const)
    .run(async ({ client, assert }, role) => {
      const user = await createUser(role)
      const { anna, site, job, visit, boilerA } = await setup()
      const charge = await recordBoiler(client, anna, visit, boilerA.id)
      await send(client, user, 'post', `/jobs/${job.id}/cancel`)
      await Job.query().where('id', job.id).update({ site_id: null })

      const response = await send(client, user, 'post', `/visits/${visit.id}/done`, {
        reviewed: [charge.id],
        done: [charge.id],
      })
      response.assertFlashMessage(
        'warning',
        warned('flash.visitMarkedDone', [['noSite', 'Caldaia murale — Vaillant ecoTEC']])
      )
      assert.lengthOf(await equipmentAt(site), 1)
    })
})

/**
 * An open Job at `site` (or none) whose accepted Quote has two boilers of
 * an Equipment Item, imported onto the Job itself.
 */
async function boilersOnJob(site: Site | null) {
  await completeCompany()
  const office = await createUser('office')
  const job = await createJob(await createCustomer(), { status: 'open', siteId: site?.id ?? null })
  const boiler = await createItem({ description: 'Caldaia 25 kW', maintenanceIntervalMonths: 12 })
  await StockLedger.receive(boiler, { quantity: '3', occurredOn: DateTime.now() })
  const standard = await vatCode()
  const quote = await Quotes.create(job, {
    lines: [
      {
        kind: 'item',
        itemId: boiler.id,
        description: 'Caldaia',
        quantity: '2',
        unitPrice: '1500',
        vatCodeId: standard.id,
      },
    ],
  })
  await Quotes.accept(quote)
  await quote.load('lines')
  const [charge] = await Quotes.importLines(
    quote,
    { lineIds: quote.lines.map((line) => line.id) },
    office
  )
  return { boiler, charge }
}

test.group('Equipment Items on the Job itself (#176)', () => {
  test('{$self} confirming them used creates one unit per piece, installed today')
    .with(['office', 'admin'] as const)
    .run(async ({ client, assert }, role) => {
      const user = await createUser(role)
      const site = await createSite()
      const { boiler, charge } = await boilersOnJob(site)
      assert.lengthOf(await equipmentAt(site), 0)

      const response = await send(client, user, 'post', `/charges/${charge.id}/done`)
      response.assertFlashMessage('success', it('flash.chargeWork.done'))

      const created = await equipmentAt(site)
      assert.deepEqual(
        created.map((unit) => [unit.itemId, unit.installedOn?.toISODate(), unit.chargeId]),
        Array(2).fill([boiler.id, DateTime.now().toISODate(), charge.id])
      )
    })

  test('{$self} confirming them used on a Job without a Site is warned, never refused')
    .with(['office', 'admin'] as const)
    .run(async ({ client, assert }, role) => {
      const user = await createUser(role)
      const { charge } = await boilersOnJob(null)

      const response = await send(client, user, 'post', `/charges/${charge.id}/done`)
      response.assertFlashMessage(
        'warning',
        warned('flash.chargeWork.done', [['noSite', 'Caldaia 25 kW']])
      )
      await charge.refresh()
      assert.isNotNull(charge.stockMovementId)
      assert.lengthOf(await InstalledEquipment.query().where('chargeId', charge.id), 0)
    })
})

/**
 * Corrects the Charge as `user`, sending its Item, quantity and any
 * details as the Charge page does.
 */
function correct(
  client: ApiClient,
  user: User,
  charge: Charge,
  body: { itemId: number; quantity: string } & Record<string, string | number>
) {
  return send(client, user, 'put', `/charges/${charge.id}/recorded`, body)
}

function detailsOf(charge: Charge) {
  return [
    charge.equipmentType,
    charge.equipmentMake,
    charge.equipmentModel,
    charge.equipmentSerialNumber,
  ]
}

test.group("An Equipment Charge's pending details (#169)", () => {
  test('{$self} enters them on a Charge imported from a Quote, and it installs with them')
    .with(['office', 'admin'] as const)
    .run(async ({ client, assert }, role) => {
      const user = await createUser(role)
      const site = await createSite()
      const { boiler, charge } = await boilersOnJob(site)

      const response = await correct(client, user, charge, {
        itemId: boiler.id,
        quantity: '1',
        equipmentType: 'Caldaia a condensazione',
        make: 'Vaillant',
        model: 'ecoTEC',
        serialNumber: 'SN-169',
      })
      response.assertFlashMessage('success', it('flash.chargeCorrected'))
      await charge.refresh()
      assert.deepEqual(detailsOf(charge), [
        'Caldaia a condensazione',
        'Vaillant',
        'ecoTEC',
        'SN-169',
      ])

      await send(client, user, 'post', `/charges/${charge.id}/done`)
      const created = await equipmentAt(site)
      assert.deepEqual(
        created.map((unit) => [unit.description, unit.serialNumber, unit.chargeId]),
        [['Caldaia a condensazione — Vaillant ecoTEC', 'SN-169', charge.id]]
      )
    })

  test('{$self} corrects them on a planned Visit Charge: empty clears, left out stays')
    .with(['office', 'admin'] as const)
    .run(async ({ client, assert }, role) => {
      const user = await createUser(role)
      const { anna, visit, boilerA } = await setup()
      const charge = await recordBoiler(client, anna, visit, boilerA.id)

      const response = await correct(client, user, charge, {
        itemId: boilerA.id,
        quantity: '1',
        model: '',
        serialNumber: 'SN-NEW',
      })
      response.assertFlashMessage('success', it('flash.chargeCorrected'))
      await charge.refresh()
      assert.deepEqual(detailsOf(charge), ['Caldaia murale', 'Vaillant', null, 'SN-NEW'])

      // The history names what changed
      const events = await charge.related('events').query().where('kind', 'corrected')
      assert.deepEqual(
        events.map((event) => event.changes),
        [
          {
            before: { model: 'ecoTEC', serialNumber: 'SN-777' },
            after: { model: null, serialNumber: 'SN-NEW' },
          },
        ]
      )
    })

  test('{$self} corrects them on a not done Charge, and done again it installs with them')
    .with(['office', 'admin'] as const)
    .run(async ({ client, assert }, role) => {
      const user = await createUser(role)
      const { anna, site, visit, boilerA } = await setup()
      const charge = await recordBoiler(client, anna, visit, boilerA.id)
      await close(client, anna, visit, [charge.id])

      const response = await correct(client, user, charge, {
        itemId: boilerA.id,
        quantity: '1',
        equipmentType: 'Caldaia',
        make: 'Baxi',
        model: 'Duo-tec',
        serialNumber: 'BX-1',
      })
      response.assertFlashMessage('success', it('flash.chargeCorrected'))
      await send(client, user, 'post', `/charges/${charge.id}/done`)

      const [, created] = await equipmentAt(site)
      assert.deepEqual(
        [created.description, created.serialNumber],
        ['Caldaia — Baxi Duo-tec', 'BX-1']
      )
    })

  test('several pieces keep no serial number; an Item that is not Equipment keeps no details', async ({
    client,
    assert,
  }) => {
    const { office, anna, visit, boilerA, fitting } = await setup()
    const charge = await recordBoiler(client, anna, visit, boilerA.id)

    await correct(client, office, charge, {
      itemId: boilerA.id,
      quantity: '2',
      serialNumber: 'SN-2',
    })
    await charge.refresh()
    assert.deepEqual(detailsOf(charge), ['Caldaia murale', 'Vaillant', 'ecoTEC', null])

    await correct(client, office, charge, {
      itemId: fitting.id,
      quantity: '2',
      equipmentType: 'Caldaia',
    })
    await charge.refresh()
    assert.deepEqual(detailsOf(charge), [null, null, null, null])
  })

  test('once done they stay as they are: the equipment is managed on the Site', async ({
    client,
    assert,
  }) => {
    const { office, anna, site, visit, boilerA } = await setup()
    const charge = await recordBoiler(client, anna, visit, boilerA.id)
    await close(client, anna, visit)

    const response = await correct(client, office, charge, {
      itemId: boilerA.id,
      quantity: '1',
      make: 'Baxi',
      serialNumber: 'BX-2',
    })
    response.assertFlashMessage('success', it('flash.chargeCorrected'))
    await charge.refresh()
    assert.deepEqual(detailsOf(charge), ['Caldaia murale', 'Vaillant', 'ecoTEC', 'SN-777'])
    const [, created] = await equipmentAt(site)
    assert.deepEqual([created.make, created.serialNumber], ['Vaillant', 'SN-777'])
  })

  test('a detail over 100 characters is refused', async ({ client, assert }) => {
    const { office, anna, visit, boilerA } = await setup()
    const charge = await recordBoiler(client, anna, visit, boilerA.id)

    const response = await correct(client, office, charge, {
      itemId: boilerA.id,
      quantity: '1',
      make: 'x'.repeat(101),
    })
    assert.properties(response.flashMessage('inputErrorsBag'), ['make'])
    await charge.refresh()
    assert.equal(charge.equipmentMake, 'Vaillant')
  })

  test('the Charge page and the field Visit page show them until done', async ({
    client,
    assert,
  }) => {
    const { office, anna, visit, boilerA, fitting } = await setup()
    const charge = await recordBoiler(client, anna, visit, boilerA.id)
    await recordBoiler(client, anna, visit, fitting.id)
    const details = {
      equipmentType: 'Caldaia murale',
      make: 'Vaillant',
      model: 'ecoTEC',
      serialNumber: 'SN-777',
    }

    const edit = await client.get(`/charges/${charge.id}/edit`).withInertia().loginAs(office)
    edit.assertInertiaPropsContains({
      charge: { recorded: { item: { equipment: true }, equipment: details } },
    })

    const shown = async () => {
      const page = await client.get(`/my-visits/${visit.id}`).withInertia().loginAs(anna)
      return (page.inertiaProps.items as { details: unknown }[]).map((line) => line.details)
    }
    assert.sameDeepMembers(await shown(), [details, null])

    await close(client, anna, visit)
    assert.deepEqual(await shown(), [null, null])
  })
})
