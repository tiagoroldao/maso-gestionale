import { existsSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import ItemDocument from '#models/item_document'
import InstalledEquipment from '#models/installed_equipment'
import { storagePath } from '#services/storage'
import { createUser } from '#tests/helpers/users'
import { createItem } from '#tests/helpers/items'
import { createSite } from '#tests/helpers/sites'
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'

const manual = app.makePath('tests/fixtures/manual.pdf')

test.group('Item Documents', (group) => {
  group.each.teardown(() => rm(storagePath(), { recursive: true, force: true }))

  test('Office uploads, everyone opens, Office deletes', async ({ client, assert }) => {
    const office = await createUser('office')
    const technician = await createUser('technician')
    const item = await createItem()

    await client
      .post(`/items/${item.id}/documents`)
      .field('title', 'Manuale di installazione')
      .file('attachment', manual)
      .header('referer', `/items/${item.id}`)
      .withCsrfToken()
      .loginAs(office)

    const document = await ItemDocument.firstOrFail()
    assert.equal(document.title, 'Manuale di installazione')
    assert.equal(document.mimeType, 'application/pdf')
    assert.equal(document.originalName, 'manual.pdf')
    assert.match(document.filePath, new RegExp(`^items/${item.id}/[0-9a-f-]+\\.pdf$`))
    assert.isTrue(existsSync(storagePath(document.filePath)))

    const opened = await client.get(`/item-documents/${document.id}`).loginAs(technician)
    opened.assertStatus(200)
    opened.assertHeader('content-type', 'application/pdf')
    opened.assertHeader('x-content-type-options', 'nosniff')

    await client
      .delete(`/item-documents/${document.id}`)
      .header('referer', `/items/${item.id}`)
      .withCsrfToken()
      .loginAs(office)
    assert.isNull(await ItemDocument.find(document.id))
    assert.isFalse(existsSync(storagePath(document.filePath)))
  })

  test('only PDFs and images are accepted', async ({ client, assert }) => {
    const office = await createUser('office')
    const item = await createItem()

    const response = await client
      .post(`/items/${item.id}/documents`)
      .field('title', 'Script')
      .file('attachment', app.makePath('tests/fixtures/not_an_image.txt'))
      .header('referer', `/items/${item.id}`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)

    assert.deepEqual(response.flashMessage('inputErrorsBag').attachment, [
      "Il documento deve essere un PDF o un'immagine (JPEG, PNG o WebP)",
    ])
    assert.lengthOf(await ItemDocument.all(), 0)
  })

  test('an oversized file gets the size message, not a raw error', async ({ client, assert }) => {
    const office = await createUser('office')
    const item = await createItem()
    const big = app.makePath('tmp/oversized.pdf')
    await writeFile(big, Buffer.alloc(21 * 1024 * 1024))

    const response = await client
      .post(`/items/${item.id}/documents`)
      .field('title', 'Manuale enorme')
      .file('attachment', big)
      .header('referer', `/items/${item.id}/edit`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)

    await rm(big, { force: true })
    assert.properties(response.flashMessage('inputErrorsBag'), ['attachment'])
    assert.lengthOf(await ItemDocument.all(), 0)
  })

  test('deleting an Item removes its document files', async ({ client, assert }) => {
    const office = await createUser('office')
    const item = await createItem()
    await client
      .post(`/items/${item.id}/documents`)
      .field('title', 'Manuale')
      .file('attachment', manual)
      .withCsrfToken()
      .loginAs(office)
    const document = await ItemDocument.firstOrFail()
    assert.isTrue(existsSync(storagePath(document.filePath)))

    await client.delete(`/items/${item.id}`).withCsrfToken().loginAs(office)

    assert.isNull(await ItemDocument.find(document.id))
    assert.isFalse(existsSync(storagePath(document.filePath)))
  })

  test('serves Italian file names and refuses missing files and outsiders', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const superuser = await createUser('superuser')
    const item = await createItem()
    await client
      .post(`/items/${item.id}/documents`)
      .field('title', 'Schema')
      .file('attachment', manual, { filename: "Schema dell'impianto è.pdf" })
      .withCsrfToken()
      .loginAs(office)
    const document = await ItemDocument.firstOrFail()

    const opened = await client.get(`/item-documents/${document.id}`).loginAs(office)
    opened.assertStatus(200)
    opened.assertHeader('content-security-policy', 'sandbox')
    assert.include(opened.header('content-disposition'), "Schema dell'impianto")

    const outsider = await client.get(`/item-documents/${document.id}`).loginAs(superuser)
    outsider.assertStatus(403)

    await rm(storagePath(document.filePath))
    const missing = await client.get(`/item-documents/${document.id}`).loginAs(office)
    missing.assertStatus(404)
  })

  test('Technicians can not upload or delete documents', async ({ client, assert }) => {
    const technician = await createUser('technician')
    const item = await createItem()
    const document = await item.related('documents').create({
      title: 'Scheda',
      filePath: 'items/x.pdf',
      originalName: 'x.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
    })

    for (const request of [
      client.post(`/items/${item.id}/documents`).field('title', 'X').file('attachment', manual),
      client.delete(`/item-documents/${document.id}`),
    ]) {
      const response = await request
        .header('referer', '/')
        .withCsrfToken()
        .loginAs(technician)
        .redirects(0)
      response.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
    }
    assert.lengthOf(await ItemDocument.all(), 1)
  })
})

test.group('Installed Equipment linked to an Item', () => {
  test('links an Item and shows its documents', async ({ client, assert }) => {
    const office = await createUser('office')
    const site = await createSite()
    const item = await createItem({ description: 'Caldaia a condensazione 25 kW' })
    await item.related('documents').create({
      title: 'Manuale',
      filePath: 'items/m.pdf',
      originalName: 'm.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
    })

    await client
      .post(`/sites/${site.id}/equipment`)
      .form({ equipmentType: 'Caldaia', itemId: String(item.id) })
      .withCsrfToken()
      .loginAs(office)

    const equipment = await InstalledEquipment.firstOrFail()
    assert.equal(equipment.itemId, item.id)

    const page = await client.get(`/equipment/${equipment.id}/edit`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({
      equipment: { item: { id: item.id, documents: [{ title: 'Manuale' }] } },
    })

    const history = await client.get(`/sites/${site.id}`).withInertia().loginAs(office)
    history.assertInertiaPropsContains({
      installedEquipment: [{ itemCode: item.code, documentCount: 1 }],
    })
  })

  test('the Item picker offers the default Maintenance Interval', async ({ client }) => {
    const office = await createUser('office')
    await createItem({ code: 'CALD-25', maintenanceIntervalMonths: 12 })

    const response = await client.get('/items/search').qs({ q: 'cald' }).loginAs(office)

    response.assertBodyContains({ items: [{ code: 'CALD-25', maintenanceIntervalMonths: 12 }] })
  })

  test('unlinking on edit removes the Item', async ({ client, assert }) => {
    const office = await createUser('office')
    const site = await createSite()
    const item = await createItem()
    const equipment = await site
      .related('installedEquipment')
      .create({ equipmentType: 'Caldaia', itemId: item.id })

    await client
      .put(`/equipment/${equipment.id}`)
      .form({ equipmentType: 'Caldaia', itemId: '' })
      .withCsrfToken()
      .loginAs(office)

    await equipment.refresh()
    assert.isNull(equipment.itemId)
  })

  test('an Item linked to equipment can only be archived', async ({ client, assert }) => {
    const office = await createUser('office')
    const site = await createSite()
    const item = await createItem()
    await site.related('installedEquipment').create({ equipmentType: 'Caldaia', itemId: item.id })

    const response = await client
      .delete(`/items/${item.id}`)
      .header('referer', `/items/${item.id}/edit`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)

    response.assertFlashMessage('error', it('flash.itemInUse', { code: item.code }))
    assert.isNotNull(await item.refresh())
  })
})
