import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { existsSync, readdirSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import app from '@adonisjs/core/services/app'
import { storagePath } from '#services/storage'
import Visit from '#models/visit'
import VisitPhoto from '#models/visit_photo'
import Charge from '#models/charge'
import LabourRate from '#models/labour_rate'
import StockMovement from '#models/stock_movement'
import StockLedger from '#stock/stock_ledger'
import FieldWork from '#services/field_work'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createSite } from '#tests/helpers/sites'
import { createItem } from '#tests/helpers/items'
import { createJob } from '#tests/helpers/jobs'
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'

async function setup() {
  const anna = await createUser('technician')
  const bruno = await createUser('technician')
  const site = await createSite()
  const job = await createJob(await createCustomer(), {
    status: 'in_progress',
    siteId: site.id,
  })
  // Started an hour ago: a planned Visit closes only once its start passed (#174)
  const start = DateTime.now().minus({ hours: 1 })
  const visit = await Visit.create({
    jobId: job.id,
    startsAt: start,
    endsAt: start.plus({ hours: 2 }),
    status: 'planned',
  })
  await visit.related('technicians').attach([anna.id, bruno.id])
  const rate = await LabourRate.create({ name: 'Idraulico', hourlyPrice: '40' })
  const item = await createItem({
    code: 'CALD-25',
    description: 'Caldaia 25 kW',
    resalePrice: '1200',
    maintenanceIntervalMonths: 12,
  })
  return { anna, bruno, site, job, visit, rate, item }
}

test.group('Field work', () => {
  test('records hours for the team at a Labour Rate', async ({ client, assert }) => {
    const { anna, bruno, visit, rate } = await setup()

    for (const [technician, hours] of [
      [anna, '2,5'],
      [bruno, '1'],
    ] as const) {
      await client
        .post(`/my-visits/${visit.id}/hours`)
        .form({ technicianId: String(technician.id), labourRateId: String(rate.id), hours })
        .withCsrfToken()
        .loginAs(anna)
    }

    await visit.load('hours')
    assert.sameMembers(
      visit.hours.map((hour) => `${hour.userId}:${hour.quantity}`),
      [`${anna.id}:2.500`, `${bruno.id}:1.000`]
    )
  })

  test('hours only for Technicians on the Visit, and never zero', async ({ client, assert }) => {
    const { anna, visit, rate } = await setup()
    const outsider = await createUser('technician')

    const notOnVisit = await client
      .post(`/my-visits/${visit.id}/hours`)
      .form({ technicianId: String(outsider.id), labourRateId: String(rate.id), hours: '1' })
      .withCsrfToken()
      .loginAs(anna)
      .redirects(0)
    notOnVisit.assertFlashMessage('error', it('flash.fieldWorkRefused.notOnVisit'))

    const zero = await client
      .post(`/my-visits/${visit.id}/hours`)
      .form({ technicianId: String(anna.id), labourRateId: String(rate.id), hours: '0' })
      .header('referer', `/my-visits/${visit.id}`)
      .withCsrfToken()
      .loginAs(anna)
      .redirects(0)
    assert.properties(zero.flashMessage('inputErrorsBag'), ['hours'])

    await visit.load('hours')
    assert.lengthOf(visit.hours, 0)
  })

  test('marking the Visit done takes the Items off stock once, then locks it', async ({
    client,
    assert,
  }) => {
    const { anna, visit, item } = await setup()
    await StockLedger.receive(item, { quantity: '5', occurredOn: DateTime.now() })
    await client
      .post(`/my-visits/${visit.id}/items`)
      .form({ itemId: String(item.id), quantity: '2' })
      .withCsrfToken()
      .loginAs(anna)

    await client
      .post(`/my-visits/${visit.id}/status`)
      .form({ status: 'done' })
      .withCsrfToken()
      .loginAs(anna)

    await visit.refresh()
    assert.equal(visit.status, 'done')
    assert.equal(await StockLedger.levelOf(item), '3.000')
    const usage = await StockMovement.query().where('kind', 'usage').firstOrFail()
    assert.equal(usage.quantity, '-2.000')
    const line = await Charge.query().where('kind', 'item').firstOrFail()
    assert.equal(line.stockMovementId, usage.id)

    // Done is final: no status change, no new lines, no double deduction
    const reopen = await client
      .post(`/my-visits/${visit.id}/status`)
      .form({ status: 'planned' })
      .withCsrfToken()
      .loginAs(anna)
      .redirects(0)
    reopen.assertFlashMessage('error', it('flash.visitDone'))
    const more = await client
      .post(`/my-visits/${visit.id}/items`)
      .form({ itemId: String(item.id), quantity: '1' })
      .withCsrfToken()
      .loginAs(anna)
      .redirects(0)
    more.assertFlashMessage('error', it('flash.fieldWorkRefused.done'))
    await client
      .post(`/my-visits/${visit.id}/status`)
      .form({ status: 'done' })
      .withCsrfToken()
      .loginAs(anna)
    assert.equal(await StockLedger.levelOf(item), '3.000')
  })

  test('needing another visit also takes the Items off stock and closes the Visit', async ({
    client,
    assert,
  }) => {
    const { anna, visit, item, job, rate } = await setup()
    await client
      .post(`/my-visits/${visit.id}/items`)
      .form({ itemId: String(item.id), quantity: '2' })
      .withCsrfToken()
      .loginAs(anna)

    await client
      .post(`/my-visits/${visit.id}/status`)
      .form({ status: 'needs_return' })
      .withCsrfToken()
      .loginAs(anna)

    assert.equal(await StockLedger.levelOf(item), '-2.000')
    const usage = await StockMovement.query().where('kind', 'usage').firstOrFail()
    assert.equal(usage.reference, job.number)
    assert.equal(usage.occurredOn.toISODate(), visit.startsAt.toISODate())
    const more = await client
      .post(`/my-visits/${visit.id}/hours`)
      .form({ technicianId: String(anna.id), labourRateId: String(rate.id), hours: '1' })
      .withCsrfToken()
      .loginAs(anna)
      .redirects(0)
    more.assertFlashMessage('error', it('flash.fieldWorkRefused.done'))
  })

  test('a planned Visit still to come can not be closed: nothing leaves stock (#174)', async ({
    client,
    assert,
  }) => {
    const { anna, visit, item } = await setup()
    const startsAt = DateTime.now().plus({ minutes: 5 })
    await visit.merge({ startsAt, endsAt: startsAt.plus({ hours: 2 }) }).save()
    await FieldWork.recordItem(visit, { itemId: item.id, quantity: '2' })

    for (const status of ['done', 'needs_return', 'in_progress'] as const) {
      const response = await client
        .post(`/my-visits/${visit.id}/status`)
        .form({ status })
        .withCsrfToken()
        .loginAs(anna)
        .redirects(0)
      await visit.refresh()
      if (status === 'in_progress') {
        // Under way early is fine: nothing leaves stock
        assert.equal(visit.status, 'in_progress')
        continue
      }
      response.assertFlashMessage('error', it('flash.fieldWorkRefused.notStarted'))
      assert.equal(visit.status, 'planned')
    }
    assert.lengthOf(await StockMovement.all(), 0)
    const charge = await Charge.query().where('visitId', visit.id).preload('events').firstOrFail()
    assert.equal(charge.workState, 'planned')
  })

  test('recorded work keeps its price when the rate changes later', async ({ client }) => {
    const { anna, job, visit, rate } = await setup()
    const admin = await createUser('admin')
    await client
      .post(`/my-visits/${visit.id}/hours`)
      .form({ technicianId: String(anna.id), labourRateId: String(rate.id), hours: '2' })
      .withCsrfToken()
      .loginAs(anna)

    await client
      .put(`/settings/rates/${rate.id}`)
      .form({ name: rate.name, hourlyPrice: '45' })
      .withCsrfToken()
      .loginAs(admin)

    const page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(admin)
    page.assertInertiaPropsContains({ timeAndMaterials: { total: '80.00' } })
  })

  test("Technicians not on the Visit can't record or remove anything", async ({
    client,
    assert,
  }) => {
    const { anna, visit, rate, item } = await setup()
    const outsider = await createUser('technician')
    const hour = await FieldWork.recordHours(visit, {
      technicianId: anna.id,
      labourRateId: rate.id,
      hours: '1',
    })

    for (const request of [
      client
        .post(`/my-visits/${visit.id}/hours`)
        .form({ technicianId: String(outsider.id), labourRateId: String(rate.id), hours: '1' }),
      client.post(`/my-visits/${visit.id}/items`).form({ itemId: String(item.id), quantity: '1' }),
      client.delete(`/charges/${hour.id}`),
      client.post(`/my-visits/${visit.id}/notes`).form({ body: 'Non è mio' }),
      client
        .post(`/my-visits/${visit.id}/photos`)
        .file('photo', app.makePath('tests/fixtures/logo.png')),
      client.post(`/my-visits/${visit.id}/serviced`).form({ equipmentIds: [] }),
    ]) {
      const response = await request
        .header('referer', '/')
        .withCsrfToken()
        .loginAs(outsider)
        .redirects(0)
      response.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
    }
    await visit.load('hours')
    assert.lengthOf(visit.hours, 1)
    await visit.load('items')
    assert.lengthOf(visit.items, 0)
    await visit.load('fieldNotes')
    assert.lengthOf(visit.fieldNotes, 0)
    await visit.load('photos')
    assert.lengthOf(visit.photos, 0)
    // Refused before the upload was stored
    assert.isFalse(existsSync(storagePath(`visits/${visit.id}`)))
  })

  test('the Superuser is refused on every field-work route', async ({ client, assert }) => {
    const { anna, visit, rate, item } = await setup()
    const superuser = await createUser('superuser')
    const hour = await FieldWork.recordHours(visit, {
      technicianId: anna.id,
      labourRateId: rate.id,
      hours: '1',
    })
    const photo = await VisitPhoto.create({
      visitId: visit.id,
      userId: anna.id,
      filePath: `visits/${visit.id}/foto.png`,
      mimeType: 'image/png',
      sizeBytes: 1,
    })

    for (const url of [
      '/my-visits',
      `/my-visits/${visit.id}`,
      `/visit-photos/${photo.id}`,
      `/my-visits/${visit.id}/item-documents/1`,
      `/my-visits/${visit.id}/issued-documents/1`,
    ]) {
      const response = await client.get(url).loginAs(superuser)
      assert.equal(response.status(), 403, url)
    }
    for (const request of [
      client.post(`/my-visits/${visit.id}/status`).form({ status: 'done' }),
      client.post(`/my-visits/${visit.id}/notes`).form({ body: 'Supporto' }),
      client
        .post(`/my-visits/${visit.id}/photos`)
        .file('photo', app.makePath('tests/fixtures/logo.png')),
      client
        .post(`/my-visits/${visit.id}/hours`)
        .form({ technicianId: String(anna.id), labourRateId: String(rate.id), hours: '1' }),
      client.post(`/my-visits/${visit.id}/items`).form({ itemId: String(item.id), quantity: '1' }),
      client.post(`/my-visits/${visit.id}/serviced`).form({ equipmentIds: [] }),
      client.delete(`/charges/${hour.id}`),
    ]) {
      const response = await request
        .header('referer', '/')
        .withCsrfToken()
        .loginAs(superuser)
        .redirects(0)
      response.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
    }

    await visit.refresh()
    assert.equal(visit.status, 'planned')
    for (const relation of ['hours', 'items', 'fieldNotes', 'photos'] as const) {
      await visit.load(relation)
    }
    assert.deepEqual(
      [visit.hours.length, visit.items.length, visit.fieldNotes.length, visit.photos.length],
      [1, 0, 0, 1]
    )
  })

  test('a photo that is not an image is refused, and not stored', async ({ client, assert }) => {
    const { anna, visit } = await setup()

    const response = await client
      .post(`/my-visits/${visit.id}/photos`)
      .file('photo', app.makePath('tests/fixtures/not_an_image.txt'))
      .header('referer', `/my-visits/${visit.id}`)
      .withCsrfToken()
      .loginAs(anna)
      .redirects(0)

    assert.deepEqual(response.flashMessage('inputErrorsBag').photo, [
      it('validator.shared.messages.photo.file.extname'),
    ])
    await visit.load('photos')
    assert.lengthOf(visit.photos, 0)
    assert.isFalse(existsSync(storagePath(`visits/${visit.id}`)))
  })

  test('Office sees the running total and Work Complete; Technicians see no prices', async ({
    client,
    assert,
  }) => {
    const { anna, job, visit, rate, item } = await setup()
    const office = await createUser('office')
    await client
      .post(`/my-visits/${visit.id}/hours`)
      .form({ technicianId: String(anna.id), labourRateId: String(rate.id), hours: '2,5' })
      .withCsrfToken()
      .loginAs(anna)
    await client
      .post(`/my-visits/${visit.id}/items`)
      .form({ itemId: String(item.id), quantity: '1' })
      .withCsrfToken()
      .loginAs(anna)

    const technicianView = await client.get(`/my-visits/${visit.id}`).withInertia().loginAs(anna)
    assert.notMatch(JSON.stringify(technicianView.inertiaProps), /price|cost|total|1200|"40/i)

    await client
      .post(`/my-visits/${visit.id}/status`)
      .form({ status: 'done' })
      .withCsrfToken()
      .loginAs(anna)

    // 2.5 h × 40 + 1 × 1200 = 1300
    const page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({
      timeAndMaterials: { total: '1300.00' },
      job: { status: 'in_progress', indicators: { workComplete: true } },
    })

    const titles = async (status: string) => {
      const list = await client.get('/jobs').qs({ status }).withInertia().loginAs(office)
      return (list.inertiaProps.jobs as { id: number }[]).map((row) => row.id)
    }
    assert.deepEqual(await titles('work_complete'), [job.id])
    assert.deepEqual(await titles('in_progress'), [job.id])

    const technicianJob = await client.get(`/jobs/${job.id}`).withInertia().loginAs(anna)
    technicianJob.assertStatus(403)
  })
})

test.group("Field work on a closed or cancelled Job's Visits", () => {
  test('hours, Items, status changes, notes and photos are all refused once {$self}')
    .with(['closed', 'cancelled'] as const)
    .run(async ({ client, assert }, status) => {
      const action = status === 'closed' ? 'close' : 'cancel'
      const { anna, job, visit, rate, item } = await setup()
      const hour = await FieldWork.recordHours(visit, {
        technicianId: anna.id,
        labourRateId: rate.id,
        hours: '1',
      })
      const line = await FieldWork.recordItem(visit, { itemId: item.id, quantity: '1' })
      await client
        .post(`/jobs/${job.id}/${action}`)
        .withCsrfToken()
        .loginAs(await createUser('office'))

      for (const request of [
        client
          .post(`/my-visits/${visit.id}/hours`)
          .form({ technicianId: String(anna.id), labourRateId: String(rate.id), hours: '1' }),
        client
          .post(`/my-visits/${visit.id}/items`)
          .form({ itemId: String(item.id), quantity: '1' }),
        client.delete(`/charges/${hour.id}`),
        client.delete(`/charges/${line.id}`),
        client.post(`/my-visits/${visit.id}/status`).form({ status: 'done' }),
        client.post(`/my-visits/${visit.id}/notes`).form({ body: 'Lavoro finito' }),
        client
          .post(`/my-visits/${visit.id}/photos`)
          .file('photo', app.makePath('tests/fixtures/logo.png')),
      ]) {
        const response = await request.withCsrfToken().loginAs(anna).redirects(0)
        response.assertFlashMessage('error', it(`flash.fieldWorkRefused.${status}`))
      }

      await visit.refresh()
      await visit.load('hours')
      await visit.load('items')
      await visit.load('fieldNotes')
      await visit.load('photos')
      assert.equal(visit.status, 'planned', status)
      assert.lengthOf(visit.hours, 1)
      assert.lengthOf(visit.items, 1)
      // The refused photo's file was removed again
      const folder = storagePath(`visits/${visit.id}`)
      assert.isTrue(!existsSync(folder) || readdirSync(folder).length === 0)
      assert.lengthOf(visit.fieldNotes, 0)
      assert.lengthOf(visit.photos, 0)
      assert.lengthOf(await StockMovement.all(), 0)
    })

  test('notes and photos still go on a closed Visit of an active Job', async ({
    client,
    assert,
  }) => {
    const { anna, visit } = await setup()
    visit.status = 'done'
    await visit.save()

    await client
      .post(`/my-visits/${visit.id}/notes`)
      .form({ body: 'Ricontrollato il giorno dopo' })
      .withCsrfToken()
      .loginAs(anna)
    await client
      .post(`/my-visits/${visit.id}/photos`)
      .file('photo', app.makePath('tests/fixtures/logo.png'))
      .withCsrfToken()
      .loginAs(anna)

    await visit.load('fieldNotes')
    await visit.load('photos')
    assert.lengthOf(visit.fieldNotes, 1)
    assert.lengthOf(visit.photos, 1)
    await rm(storagePath(), { recursive: true, force: true })
  })

  test("the Visit page shows a {$self} Job's Visit as read-only")
    .with(['closed', 'cancelled'] as const)
    .run(async ({ client }, status) => {
      const { anna, job, visit } = await setup()
      job.merge({ status })
      await job.save()

      const page = await client.get(`/my-visits/${visit.id}`).withInertia().loginAs(anna)

      page.assertInertiaPropsContains({ done: true })
    })
})
