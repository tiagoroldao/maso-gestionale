import { test } from '@japa/runner'
import Item from '#models/item'
import Category from '#models/category'
import { createUser } from '#tests/helpers/users'
import { createCategory, createItem } from '#tests/helpers/items'
import { it } from '#tests/helpers/i18n'

const itemFields = {
  code: 'rac-12',
  description: 'Raccordo a T in ottone 1/2"',
  unit: 'pz',
  supplierName: 'Idrotermica Srl',
  supplierCode: 'OT-T12',
  vatRate: '22',
  purchasePrice: '1,2345',
  resalePrice: '1,90',
}

test.group('Items', () => {
  test('Office creates an Item, with prices typed the Italian way', async ({ client, assert }) => {
    const office = await createUser('office')
    const category = await createCategory()

    const response = await client
      .post('/items')
      .form({ ...itemFields, categoryId: String(category.id) })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)

    response.assertHeader('location', '/items')
    const item = await Item.firstOrFail()
    assert.equal(item.code, 'RAC-12')
    assert.equal(item.purchasePrice, '1.2345')
    assert.equal(item.resalePrice, '1.9000')
    assert.equal(item.vatRate, '22.00')
    assert.equal(item.categoryId, category.id)
  })

  test('rejects duplicate codes and malformed amounts', async ({ client, assert }) => {
    const office = await createUser('office')
    await createItem({ code: 'RAC-12' })

    const response = await client
      .post('/items')
      .form({ ...itemFields, purchasePrice: '1.234,56', resalePrice: '-1', vatRate: '150' })
      .header('referer', '/items/create')
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)

    assert.properties(response.flashMessage('inputErrorsBag'), [
      'code',
      'purchasePrice',
      'resalePrice',
      'vatRate',
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

  test('Technicians can not open the Item screens', async ({ client }) => {
    const technician = await createUser('technician')
    const item = await createItem()

    for (const url of ['/items', '/items/create', `/items/${item.id}/edit`]) {
      const response = await client.get(url).withInertia().loginAs(technician)
      response.assertStatus(403)
    }
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

  test('only the Admin manages Categories', async ({ client }) => {
    const office = await createUser('office')
    const response = await client.get('/settings/categories').withInertia().loginAs(office)
    response.assertStatus(403)
  })
})
