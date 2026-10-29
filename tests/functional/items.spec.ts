import { test } from '@japa/runner'
import Item from '#models/item'
import Category from '#models/category'
import { createUser } from '#tests/helpers/users'
import { createCategory, createItem, vatCode } from '#tests/helpers/items'
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'

const itemFields = {
  code: 'rac-12',
  description: 'Raccordo a T in ottone 1/2"',
  unit: 'pz',
  supplierName: 'Idrotermica Srl',
  supplierCode: 'OT-T12',
  purchasePrice: '1,2345',
  resalePrice: '1,90',
  vatCodeId: '',
}

test.group('Items', (group) => {
  group.each.setup(async () => {
    const standard = await vatCode()
    itemFields.vatCodeId = String(standard.id)
  })

  test('Office creates an Item, with prices typed the Italian way', async ({ client, assert }) => {
    const office = await createUser('office')
    const category = await createCategory()

    const reduced = await vatCode('10%')

    const response = await client
      .post('/items')
      .form({
        ...itemFields,
        categoryId: String(category.id),
        vatCodeId: String(reduced.id),
        significantGood: 'true',
      })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)

    const item = await Item.firstOrFail()
    response.assertHeader('location', `/items/${item.id}`)
    assert.equal(item.code, 'RAC-12')
    assert.equal(item.purchasePrice, '1.2345')
    assert.equal(item.resalePrice, '1.9000')
    assert.equal(item.vatCodeId, reduced.id)
    assert.isTrue(item.significantGood)
    assert.equal(item.categoryId, category.id)
  })

  test('rejects duplicate codes and malformed amounts', async ({ client, assert }) => {
    const office = await createUser('office')
    await createItem({ code: 'RAC-12' })

    const response = await client
      .post('/items')
      .form({
        ...itemFields,
        purchasePrice: '1.234,56',
        resalePrice: '1,23456',
        vatCodeId: '999999',
      })
      .header('referer', '/items/create')
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)

    assert.properties(response.flashMessage('inputErrorsBag'), [
      'code',
      'purchasePrice',
      'resalePrice',
      'vatCodeId',
    ])
    assert.lengthOf(await Item.all(), 1)
  })

  test('changing the purchase price never changes the resale price', async ({ client, assert }) => {
    const office = await createUser('office')
    const item = await createItem({ purchasePrice: '10', resalePrice: '13.5' })

    await client
      .put(`/items/${item.id}`)
      .form({ ...itemFields, code: item.code, purchasePrice: '12', resalePrice: '13,50' })
      .withCsrfToken()
      .loginAs(office)

    await item.refresh()
    assert.equal(item.purchasePrice, '12.0000')
    assert.equal(item.resalePrice, '13.5000')
  })

  test('changing a Category markup never changes resale prices', async ({ client, assert }) => {
    const admin = await createUser('admin')
    const category = await createCategory({ markupPercent: '35' })
    const item = await createItem({ categoryId: category.id, resalePrice: '13.5' })

    await client
      .put(`/settings/categories/${category.id}`)
      .form({ name: category.name, markupPercent: '80' })
      .withCsrfToken()
      .loginAs(admin)

    await category.refresh()
    await item.refresh()
    assert.equal(category.markupPercent, '80.00')
    assert.equal(item.resalePrice, '13.5000')
  })

  test('searches by code, description and supplier code', async ({ client, assert }) => {
    const office = await createUser('office')
    await createItem({ code: 'RAC-12', description: 'Raccordo a T', supplierCode: 'OT-T12' })
    await createItem({ code: 'VAL-01', description: 'Valvola a sfera' })

    const search = async (q: string) => {
      const response = await client.get('/items').qs({ q }).withInertia().loginAs(office)
      return (response.inertiaProps.items as { code: string }[]).map((item) => item.code)
    }

    assert.deepEqual(await search('rac'), ['RAC-12'])
    assert.deepEqual(await search('sfera'), ['VAL-01'])
    assert.deepEqual(await search('ot-t12'), ['RAC-12'])
  })

  test('Technicians can not open or change Items', async ({ client, assert }) => {
    const technician = await createUser('technician')
    const item = await createItem({ description: 'Original' })

    for (const url of ['/items', '/items/create', `/items/${item.id}/edit`]) {
      const response = await client.get(url).withInertia().loginAs(technician)
      response.assertStatus(403)
    }
    for (const request of [
      client.post('/items').form({ ...itemFields, code: 'NEW' }),
      client.put(`/items/${item.id}`).form({ ...itemFields, code: item.code }),
      client.delete(`/items/${item.id}`),
    ]) {
      const response = await request
        .header('referer', '/')
        .withCsrfToken()
        .loginAs(technician)
        .redirects(0)
      response.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
    }

    await item.refresh()
    assert.equal(item.description, 'Original')
    assert.lengthOf(await Item.all(), 1)
  })

  test('the edit page receives prices exactly as stored', async ({ client }) => {
    const office = await createUser('office')
    const item = await createItem({ purchasePrice: '1.2345', resalePrice: '0.0345' })

    const response = await client.get(`/items/${item.id}/edit`).withInertia().loginAs(office)

    response.assertInertiaPropsContains({
      item: {
        purchasePrice: '1.2345',
        resalePrice: '0.0345',
        significantGood: false,
        archived: false,
      },
    })
  })

  test('clearing the Category and supplier on edit removes them', async ({ client, assert }) => {
    const office = await createUser('office')
    const category = await createCategory()
    const item = await createItem({ categoryId: category.id, supplierName: 'Idrotermica' })

    await client
      .put(`/items/${item.id}`)
      .form({ ...itemFields, code: item.code, categoryId: '', supplierName: '' })
      .withCsrfToken()
      .loginAs(office)

    await item.refresh()
    assert.isNull(item.categoryId)
    assert.isNull(item.supplierName)
  })

  test('archived Items leave the list and the picker, and can be restored', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const item = await createItem({ code: 'OLD-1' })

    await client.post(`/items/${item.id}/archive`).withCsrfToken().loginAs(office)
    await item.refresh()
    assert.isNotNull(item.archivedAt)

    const codes = async (qs: Record<string, string>) => {
      const response = await client.get('/items').qs(qs).withInertia().loginAs(office)
      return (response.inertiaProps.items as { code: string }[]).map((row) => row.code)
    }
    assert.deepEqual(await codes({}), [])
    assert.deepEqual(await codes({ archived: 'true' }), ['OLD-1'])
    const picker = await client.get('/items/search').qs({ q: 'old' }).loginAs(office)
    assert.lengthOf(picker.body().items, 0)

    await client.post(`/items/${item.id}/unarchive`).withCsrfToken().loginAs(office)
    assert.deepEqual(await codes({}), ['OLD-1'])
  })

  test('an Item that was never used can be deleted', async ({ client, assert }) => {
    const office = await createUser('office')
    const item = await createItem()

    await client.delete(`/items/${item.id}`).withCsrfToken().loginAs(office)

    assert.isNull(await Item.find(item.id))
  })

  test('the Item picker never sends prices to Technicians', async ({ client, assert }) => {
    await createItem({ code: 'RAC-12' })

    const technician = await createUser('technician')
    const forTechnician = await client.get('/items/search').qs({ q: 'rac' }).loginAs(technician)
    const [technicianItem] = forTechnician.body().items
    assert.equal(technicianItem.code, 'RAC-12')
    assert.notProperty(technicianItem, 'purchasePrice')
    assert.notProperty(technicianItem, 'resalePrice')
    assert.notInclude(JSON.stringify(forTechnician.body()), '13.5')

    const office = await createUser('office')
    const forOffice = await client.get('/items/search').qs({ q: 'rac' }).loginAs(office)
    assert.equal(forOffice.body().items[0].resalePrice, '13.5000')
  })
})

test.group('Equipment and Groupable Items (#176)', (group) => {
  group.each.setup(async () => {
    const standard = await vatCode()
    itemFields.vatCodeId = String(standard.id)
  })

  test('{$self} sets both flags on the form; the list and the edit page show them')
    .with(['office', 'admin'] as const)
    .run(async ({ client, assert }, role) => {
      const user = await createUser(role)

      // Ticked boxes send "true"; unticked ones are left out
      await client
        .post('/items')
        .form({ ...itemFields, equipment: 'true', maintenanceIntervalMonths: '12' })
        .withCsrfToken()
        .loginAs(user)
      const item = await Item.firstOrFail()
      assert.deepEqual([item.equipment, item.groupable], [true, false])

      const list = await client.get('/items').withInertia().loginAs(user)
      list.assertInertiaPropsContains({
        items: [{ code: 'RAC-12', equipment: true, groupable: false }],
      })

      await client
        .put(`/items/${item.id}`)
        .form({ ...itemFields, code: item.code, groupable: 'true' })
        .withCsrfToken()
        .loginAs(user)
      await item.refresh()
      assert.deepEqual([item.equipment, item.groupable], [false, true])
      const edit = await client.get(`/items/${item.id}/edit`).withInertia().loginAs(user)
      edit.assertInertiaPropsContains({ item: { equipment: false, groupable: true } })
    })

  test('an Item created without the flags gets the defaults', async ({ assert }) => {
    const plain = await createItem()
    const boiler = await createItem({ maintenanceIntervalMonths: 12 })
    const toilet = await createItem({ significantGood: true })
    const chosen = await createItem({ maintenanceIntervalMonths: 12, equipment: false })

    assert.deepEqual(
      [plain, boiler, toilet, chosen].map((item) => [item.equipment, item.groupable]),
      [
        [false, true],
        [true, false],
        [false, false],
        [false, false],
      ]
    )
  })

  test('the picker tells every role whether an Item is Equipment', async ({ client, assert }) => {
    await createItem({ code: 'CAL-25', maintenanceIntervalMonths: 12 })

    for (const role of ['technician', 'office'] as const) {
      const response = await client
        .get('/items/search')
        .qs({ q: 'cal' })
        .loginAs(await createUser(role))
      assert.isTrue(response.body().items[0].equipment)
    }
  })

  test('Technicians and the Superuser can not change the flags', async ({ client, assert }) => {
    const item = await createItem()

    for (const role of ['technician', 'superuser'] as const) {
      const response = await client
        .put(`/items/${item.id}`)
        .form({ ...itemFields, code: item.code, equipment: 'true' })
        .header('referer', '/')
        .withCsrfToken()
        .loginAs(await createUser(role))
        .redirects(0)
      response.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
    }

    await item.refresh()
    assert.deepEqual([item.equipment, item.groupable], [false, true])
  })
})

test.group('Categories', () => {
  test('the Admin adds Categories with a markup', async ({ client }) => {
    const admin = await createUser('admin')

    await client
      .post('/settings/categories')
      .form({ name: 'Caldaie', markupPercent: '25,5' })
      .withCsrfToken()
      .loginAs(admin)

    const response = await client.get('/settings/categories').withInertia().loginAs(admin)
    response.assertInertiaPropsContains({
      categories: [{ name: 'Caldaie', markupPercent: '25.50', itemCount: 0 }],
    })
  })

  test('a Category used by Items can not be deleted', async ({ client, assert }) => {
    const admin = await createUser('admin')
    const category = await createCategory()
    await createItem({ categoryId: category.id })

    const response = await client
      .delete(`/settings/categories/${category.id}`)
      .withCsrfToken()
      .loginAs(admin)
      .redirects(0)

    response.assertFlashMessage('error', it('flash.categoryInUse', { name: category.name }))
    assert.isNotNull(await Category.find(category.id))
  })

  test('only the Admin manages Categories', async ({ client, assert }) => {
    const office = await createUser('office')
    const category = await createCategory({ name: 'Raccorderia', markupPercent: '35' })

    const page = await client.get('/settings/categories').withInertia().loginAs(office)
    page.assertStatus(403)

    for (const request of [
      client.post('/settings/categories').form({ name: 'Nuova', markupPercent: '10' }),
      client.put(`/settings/categories/${category.id}`).form({ name: 'X', markupPercent: '99' }),
      client.delete(`/settings/categories/${category.id}`),
    ]) {
      const response = await request
        .header('referer', '/')
        .withCsrfToken()
        .loginAs(office)
        .redirects(0)
      response.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
    }

    await category.refresh()
    assert.equal(category.markupPercent, '35.00')
    assert.lengthOf(await Category.all(), 1)
  })
})
